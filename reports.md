## Technical Report & Design Choices

### Overview
This project demonstrates a real-time, cross-device object detection pipeline. It streams video from a mobile phone to a laptop browser using WebRTC, performs inference directly on the phone using TensorFlow.js with a WASM backend, and transmits detection metadata over a WebRTC DataChannel for overlay rendering on the receiver.

The core design philosophy is to create a self-contained, browser-based, and serverless (for media and ML) computer vision application that is accessible without specialized hardware.

### Architecture
The system is composed of several decoupled components:

-   **Signaling Server**:
    -   **Technology**: A lightweight Node.js/Express server with the `ws` library for WebSocket support.
    -   **Design Choice**: This stack was chosen for its simplicity, low overhead, and event-driven nature, which is a natural fit for a signaling relay. The server's only role is to broker the initial WebRTC connection by passing SDP offers/answers and ICE candidates between peers. It does not process or proxy any media, keeping its resource footprint minimal.
    -   **Mechanism**: It uses a "room" model where one peer creates a room and a second peer joins it. A QR code containing a tunneled HTTPS link simplifies the phone's joining process, avoiding manual URL entry.

-   **Media & Data Transport**:
    -   **Technology**: WebRTC (`RTCPeerConnection`).
    -   **Design Choice**: WebRTC is the standard for real-time, peer-to-peer communication in the browser. It provides low-latency video streaming and a reliable, ordered `RTCDataChannel` for sending structured metadata in parallel. This avoids the need for a media server, reducing cost and latency. The connection uses STUN servers for NAT traversal.

-   **Inference Engine**:
    -   **Technology**: TensorFlow.js with the WASM (WebAssembly) backend. The `coco-ssd (lite_mobilenet_v2)` model is used.
    -   **Design Choice**: On-device inference was chosen to ensure privacy and eliminate reliance on a cloud GPU server. The **WASM backend** is critical, as it offers significant performance gains over plain JavaScript for CPU-bound tasks and runs consistently across all modern browsers, unlike the WebGL/WebGPU backends which can have driver-dependent behavior. The `lite_mobilenet_v2` variant of COCO-SSD was selected as a good compromise between speed and accuracy for mobile CPUs.

### Low-Resource Mode Design

The application is explicitly designed to function on resource-constrained devices like smartphones. This is achieved through several key strategies:

1.  **WASM-Powered Inference**: As mentioned, WASM is the cornerstone of the low-resource strategy. It allows near-native execution speed on the CPU, making real-time inference feasible without requiring a device with a powerful GPU.
2.  **Adjustable Input Resolution**: The publisher UI allows the user to select the camera resolution. For inference, the video frame is internally downscaled to a fixed size (e.g., 320x240). This dramatically reduces the number of pixels the model has to process, directly improving FPS. This is the most impactful lever for performance tuning.
3.  **Lightweight Model**: The choice of `lite_mobilenet_v2` is intentional. While larger models like the full MobileNet or ResNet might offer higher accuracy, their computational cost would make them unsuitable for real-time CPU inference on a phone.

### Backpressure and System Robustness Policy

To maintain a smooth, low-latency experience under variable network and processing conditions, the system implements a strict backpressure policy.

1.  **Frame Throttling (Thinning)**:
    -   **Problem**: The model's inference time (e.g., ~150ms) is often longer than the camera's frame interval (e.g., 33ms for 30 FPS). Without a backpressure mechanism, frames would queue up, leading to ever-increasing latency as the receiver displays stale detections.
    -   **Policy**: A simple boolean flag, `isProcessing`, is used as a lock. When a new frame arrives from the camera, the system checks this flag. If it's `true`, the new frame is immediately dropped. If `false`, the flag is set to `true`, the frame is sent for processing, and the flag is cleared only after inference and data transmission are complete.
    -   **Outcome**: This policy ensures that the pipeline is never clogged. It prioritizes **freshness over completeness**, processing only the most recent available frame and guaranteeing that latency does not grow unbounded.

2.  **Confidence Filtering**:
    -   **Policy**: Detections with a confidence score below a set threshold (default: 0.5) are discarded on the publisher side before being sent.
    -   **Outcome**: This reduces network traffic by not sending low-quality data. More importantly, it prevents visual "flicker" on the receiver's overlay, where objects might appear and disappear rapidly due to noisy, low-confidence predictions.

3.  **Jitter-Resistant Tracking**:
    -   **Policy**: The receiver implements a simple, greedy IoU (Intersection over Union) tracker. When new detections arrive, they are matched to existing tracks from the previous frame.
    -   **Outcome**: This provides object persistence and smooths out the experience.
        -   **Time-to-Live (TTL)**: Each track has a TTL. If a track is not matched with a new detection for a few consecutive frames, it is removed. This cleans up stale tracks for objects that have left the scene.
        -   **Exponential Smoothing**: The position and size of the bounding boxes are updated using an exponential moving average. This dampens small, rapid changes in the detected box, resulting in a much smoother visual overlay and reducing jitter.

### Metrics methodology
-   **End-to-End Latency**: `overlay_display_ts - capture_ts`. Measures the total time from frame capture on the phone to its detection being rendered on the laptop. A one-time clock sync at the start of the session attempts to align the clocks of the two devices.
-   **Network Latency**: `recv_ts - capture_ts`. Time from frame capture to its metadata arriving at the receiver.
-   **Inference Time**: `inference_ts - recv_ts`. In WASM mode, this approximates the inference time on the phone, as reported by the sender.
-   **FPS**: Calculated as the number of frames with rendered detections divided by the elapsed time.
-   **Bandwidth**: Uplink/downlink kbps, derived from the WebRTC `getStats()` API.

### Sample results (WASM on modest laptop)
The following results were collected with the WASM model running on a modest laptop, streaming from a modern smartphone.

-   **`median_e2e_ms`**: ≈ 273 ms
-   **`p95_e2e_ms`**: ≈ 521 ms
-   **`fps`**: ≈ 6.1
-   **`uplink_kbps`**: ≈ 1560
-   **`downlink_kbps`**: ≈ 1570
-   **CPU Usage (30s avg)**: Browser ≈ 3.2%, Container ≈ 0.2%

### Tradeoffs and next steps
-   **WASM vs. Native Performance**: The primary tradeoff is portability vs. performance. WASM is universally compatible but slower than native code or a dedicated GPU server. A future "server" mode could offload inference to a more powerful machine running a quantized ONNX model (e.g., YOLOv8n) to achieve higher FPS.
-   **Clock Synchronization**: The current clock sync is a simple one-off offset calculation. A more robust implementation would use a proper RTT-based algorithm (like NTP) for greater accuracy, especially on networks with variable latency.
-   **NAT Traversal**: The demo currently relies on STUN servers only. Adding a TURN server would improve connectivity for users behind restrictive (symmetric) NATs, though it would introduce a relay and increase infrastructure costs.
