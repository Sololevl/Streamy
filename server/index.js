/* Minimal Express static server + WS signaling for WebRTC */
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
let localtunnel;
const QRCode = require('qrcode');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

// Serve static assets
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Simple health
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => res.json({ mode: process.env.MODE || 'wasm' }));

// Track a preferred external base URL (e.g., from tunnel)
let externalBaseUrl = null;

// Helper to compute origin from request if no tunnel
function computeRequestOrigin(req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}`;
}

// Return a new room and a full phone URL
app.get('/api/new-room', (req, res) => {
    const roomId = uuidv4().slice(0, 8);
    const base = externalBaseUrl || computeRequestOrigin(req);
    res.json({ roomId, phonePath: `/phone.html?room=${roomId}`, phoneUrl: `${base}/phone.html?room=${roomId}` });
});

// Generate QR as PNG to avoid CDN/script loading issues
app.get('/api/qr', async (req, res) => {
    const data = req.query.data || '';
    if (!data) return res.status(400).json({ error: 'missing data' });
    try {
        const png = await QRCode.toBuffer(data, { type: 'png', width: 180, margin: 1 });
        res.setHeader('Content-Type', 'image/png');
        res.send(png);
    } catch (e) {
        res.status(500).json({ error: 'qr_failed' });
    }
});

// Accept metrics.json upload from receiver
let lastMetrics = null;
app.post('/api/metrics', (req, res) => {
    try {
        lastMetrics = { ...req.body, _server_ts: Date.now() };
        const outPath = path.join(__dirname, '..', 'metrics.json');
        fs.writeFileSync(outPath, JSON.stringify(lastMetrics, null, 2));
        res.json({ ok: true, path: '/metrics.json' });
    } catch (e) {
        res.status(500).json({ error: 'write_failed' });
    }
});

// Return last received metrics snapshot
app.get('/api/metrics', (req, res) => {
    if (!lastMetrics) return res.status(404).json({ error: 'no_metrics' });
    res.json(lastMetrics);
});

const server = http.createServer(app);

// Very simple in-memory room mapping: roomId -> Set of client sockets
const rooms = new Map();

const wss = new WebSocketServer({ server });

function joinRoom(roomId, ws) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(ws);
    ws._roomId = roomId; // attach for cleanup
}

function leaveRoom(ws) {
    const roomId = ws._roomId;
    if (!roomId) return;
    const peers = rooms.get(roomId);
    if (peers) {
        peers.delete(ws);
        if (peers.size === 0) rooms.delete(roomId);
    }
}

wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
        const { type, roomId } = msg;

        if (type === 'join' && roomId) {
            joinRoom(roomId, ws);
            try { console.log(`[ws] join room=${roomId}`); } catch {}
            ws.send(JSON.stringify({ type: 'joined', roomId }));
            return;
        }

        // Relay signaling messages to other peers in the same room
        if (ws._roomId) {
            const peers = rooms.get(ws._roomId) || new Set();
            if (type === 'offer' || type === 'answer' || type === 'candidate') {
                try { console.log(`[ws] relay ${type} room=${ws._roomId}`); } catch {}
            }
            for (const peer of peers) {
                if (peer !== ws && peer.readyState === 1) {
                    peer.send(JSON.stringify(msg));
                }
            }
        }
    });

    ws.on('close', () => leaveRoom(ws));
    ws.on('error', () => leaveRoom(ws));
});

server.listen(PORT, async () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    try {
        const shouldTunnel = String(process.env.TUNNEL || '').toLowerCase();
        if (shouldTunnel === '1' || shouldTunnel === 'true' || shouldTunnel === 'yes') {
            // Avoid starting localtunnel in managed/cloud hosts (Render, Heroku, GAE, etc.)
            const cloudDetected = !!(
                process.env.RENDER ||
                process.env.K_SERVICE ||    // Cloud Run
                process.env.GAE_INSTANCE || // App Engine
                process.env.HEROKU ||       // (if you set)
                process.env.DYNO           // Heroku dyno
            );
            if (cloudDetected) {
                console.log('Skipping localtunnel: running in a cloud environment');
            } else {
                // Lazy require only when we actually want a tunnel
                localtunnel = require('localtunnel');
                const tunnel = await localtunnel({ port: Number(PORT) });
                externalBaseUrl = tunnel.url.replace(/\/$/, '');
                console.log(`HTTPS tunnel active: ${externalBaseUrl}`);
                // Ensure we clean up on close and do not crash the process on tunnel-level errors
                tunnel.on('close', () => { externalBaseUrl = null; });
                tunnel.on('error', (err) => {
                    console.error('Localtunnel error (non-fatal):', err && err.message ? err.message : err);
                    externalBaseUrl = null;
                    // Don't rethrow — just log and continue
                });
            }
        }
    } catch (err) {
        console.error('Tunnel error (caught):', err && err.message ? err.message : err);
    }
});


