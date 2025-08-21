# Real-time WebRTC VLM Multi-Object Detection

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A cross-device, real-time object detection demo using WebRTC for video streaming, WebAssembly (WASM) for on-device inference, and a modern browser UI. This project streams video from your phone to your laptop, runs a COCO-SSD object detection model directly in the browser, and displays live overlays with performance metrics.

The entire inference pipeline runs on-device, requiring no cloud or dedicated GPU server.

<!-- Optional: Add a GIF or screenshot of the demo in action -->
<!-x- ![Demo GIF](docs/demo.gif) -->

---

## Features

- **Phone-to-Laptop Streaming**: Secure, low-latency video streaming via WebRTC.
- **On-Device Inference**: Object detection using TensorFlow.js with the WASM backend runs entirely in your browser. No cloud/server required for ML.
- **Live Overlays & Tracking**: Detected objects are drawn on the video in real-time with a simple IoU-based tracker to smooth bounding boxes.
- **Real-time Metrics HUD**: Live display of Frames Per Second (FPS), end-to-end latency, and network bandwidth.
- **QR Code Pairing**: Simple and secure peer-to-peer connection setup.
- **Cross-Platform**: Works on any modern browser that supports WebRTC (Chrome, Edge, Firefox, Safari) on Windows, macOS, Linux, Android, and iOS.
- **Headless Benchmarking**: Includes scripts for automated performance testing and metric collection.

---

## Architecture

This demo uses a decoupled architecture for signaling, media, and data transfer.

- **Signaling Server**: A lightweight Node.js/Express server with WebSocket support acts as a signaling relay. It manages rooms to broker connections between peers but does not handle any media traffic.
- **Media Stream (WebRTC)**: The phone's camera stream is captured and sent to the receiver (laptop) via an `RTCPeerConnection`. The connection is peer-to-peer, using STUN servers for NAT traversal. Media is not relayed through the server.
- **On-Device Inference (WASM)**: The phone's browser runs object detection on each video frame.
    - It uses **TensorFlow.js** with the **WASM backend** for efficient, CPU-based inference.
    - The `coco-ssd (lite_mobilenet_v2)` model is used.
    - Video frames are downscaled (default: 320x240) to achieve near real-time performance (~6-10 FPS) on typical mobile devices.
- **Data Channel**: A WebRTC `RTCDataChannel` runs in parallel to the video stream. It sends per-frame metadata, including detection bounding boxes, labels, and timestamps, from the phone to the receiver.
- **Overlay & Tracking**: The receiver's browser renders the incoming video to a `<video>` element. A `<canvas>` is overlaid on top, where the received bounding boxes are drawn. A simple, greedy IoU-based tracker with exponential smoothing is used to reduce jitter and maintain object identity across frames.
- **HTTPS Tunnel**: `localtunnel` is used to expose the local server via a public HTTPS URL. This is necessary for browsers on mobile devices to grant camera permissions, which are restricted on insecure origins.

---

## Quick Start

### 1. Prerequisites

- Node.js (v16+ recommended)
- Docker (optional, for containerized run)
- A modern browser on both your laptop and phone.

### 2. One-command Run

The start scripts automatically use Docker if it's running, otherwise they fall back to a local `npm` installation.

- **Windows (PowerShell):**
  ```powershell
  ./start.ps1
  ```

- **macOS/Linux (Bash):**
  ```bash
  ./start.sh
  ```

### 3. Running the Demo

1.  After running the start script, open **`http://localhost:3000`** on your laptop.
2.  Click **"Create Room"**. A QR code will be displayed.
3.  Scan the QR code with your phone. This will open an HTTPS link.
    -   *Note*: The tunnel service may show a temporary interstitial page. If so, find the password on the page, copy it, and paste it to proceed.
4.  On your phone, select the desired camera (front/back) and resolution, then tap **"Start Camera"**. You must grant camera permissions.
5.  The video stream with object detection overlays should now appear on your laptop screen, along with the live metrics HUD.

> **Tip**: The tunnel URL (`*.loca.lt`) changes every time you restart the server. Always re-scan the QR code after a restart.

---

## Modes of Operation

You can switch between different modes using environment variables.

- **WASM Mode (Default)**: All inference happens on the phone's browser. This is the standard, low-resource mode.
  - PowerShell: `$env:MODE="wasm"; ./start.ps1`
  - Bash: `MODE=wasm ./start.sh`

- **Server Mode (Placeholder)**: This mode is a placeholder for a future implementation where inference could be offloaded to the server. Currently, it streams video without performing detection.
  - PowerShell: `$env:MODE="server"; ./start.ps1`
  - Bash: `MODE=server ./start.sh`

---

## Performance & Metrics

The application includes a comprehensive metrics collection and display system.

### Metrics Methodology

-   **End-to-End Latency**: `overlay_display_ts - capture_ts`. This measures the total time from when a frame is captured on the phone to when its corresponding detection is rendered on the laptop's screen. A one-time clock sync is performed at the start to align timestamps.
-   **Network Latency**: `recv_ts - capture_ts`. Time from frame capture to its metadata arriving at the receiver.
-   **Inference Time**: `inference_ts - recv_ts`. In WASM mode, this is an approximation of the inference time on the phone, as reported by the sender.
-   **FPS**: Calculated as the number of frames with rendered detections divided by the elapsed time.
-   **Bandwidth**: Uplink/downlink kbps, derived from the WebRTC `getStats()` API.

### Sample Results

The following results were collected with the WASM model running on a modest laptop, streaming from a modern smartphone.

-   **`median_e2e_ms`**: ≈ 273 ms
-   **`p95_e2e_ms`**: ≈ 521 ms
-   **`fps`**: ≈ 6.1
-   **`uplink_kbps`**: ≈ 1560
-   **`downlink_kbps`**: ≈ 1570
-   **CPU Usage (30s avg)**: Browser ≈ 3.2%, Container ≈ 0.2%

Metrics can be saved to `metrics.json` via the UI and an API endpoint. For more details on headless benchmarking, see `reports.md`.

---

## System Design for Robustness

Several mechanisms are in place to handle variable network conditions and processing loads.

-   **Frame Throttling**: A processing flag ensures that only one frame is in the inference pipeline at a time. If a new frame arrives while the previous one is still being processed, it is dropped. This "frame thinning" prevents stale frames from building up a queue and increasing latency.
-   **Confidence Filtering**: Detections with a confidence score below a threshold (default: 0.5) are discarded to reduce visual noise and flicker from low-confidence predictions.
-   **Jitter-Resistant Tracking**: The greedy IoU tracker includes a Time-to-Live (TTL) for each track. If an object isn't seen for a few frames, its track is dropped. Bounding box positions are also updated using exponential smoothing to reduce visual jitter.
-   **Automatic Reconnection**: The receiver UI is designed to wait for the WebSocket connection to be established before allowing a user to join a room. The tracker and other state are reset if the DataChannel closes, ensuring a clean state for a new connection.

---

## Troubleshooting

-   **Phone won't connect**: Ensure both devices are on the same Wi-Fi network. If not, the HTTPS tunnel link is required for NAT traversal.
-   **QR code doesn't work after restart**: The tunnel URL (`*.loca.lt`) changes on every server restart. Refresh the laptop page to get the new QR code.
-   **Negative latency values**: This can happen if the clock sync is inaccurate. Reloading the page on both devices will re-trigger the sync when the DataChannel opens.
-   **High CPU usage or low FPS**:
    -   In the phone UI, select a lower resolution like 320x240 (QVGA).
    -   Ensure you are in `wasm` mode, as this is optimized for low-resource devices.

---

## Limitations & Future Work

-   **WASM Performance vs. Native**: WASM provides excellent portability but is slower than native execution or a dedicated GPU server. A future "server" mode could use a quantized ONNX model (e.g., YOLOv8n) for higher FPS.
-   **Clock Synchronization**: The current clock sync is a simple one-off offset calculation. A more robust implementation would use a proper RTT-based algorithm (like NTP) for greater accuracy.
-   **NAT Traversal**: The demo currently relies on STUN servers only. Adding a TURN server would improve connectivity for users behind symmetric NATs.
-   **Benchmarking Automation**: The metrics collection could be unified into a single, automated benchmark script that runs the test, collects data, and generates a report.

---

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for bugs, feature requests, or improvements.

---

## License

This project is licensed under the MIT License.

