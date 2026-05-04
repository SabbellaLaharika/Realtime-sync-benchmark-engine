# Real-Time Collaboration Sync Engine: WebSockets vs HTTP Long Polling

A high-performance live document synchronization engine built to benchmark the trade-offs between **WebSockets (Full-Duplex)** and **HTTP Long Polling**. This project includes a complete benchmarking suite using **k6**, **Redis** for state management, and **Linux network simulation tools** for realistic WAN testing.

## 🚀 Key Features

- **Dual-Protocol Sync**: Seamless cursor synchronization using both WebSockets and HTTP Long Polling.
- **Stateful Presence**: Real-time connected user count tracking via `{"type": "presence", "count": X}` messages.
- **Performance Benchmarking**: Custom k6 metrics capturing nanosecond-level latency for both protocols.
- **Resilience Engineering**: Built-in "Thundering Herd" protection to handle massive concurrent polling bursts.
- **Network Simulation**: Integrated tools to simulate 100ms latency and 2% packet loss for real-world WAN testing.
- **Dockerized Infrastructure**: Fully containerized environment using Docker Compose for the App and Redis.

## 🛠️ Tech Stack

- **Backend**: Node.js
- **Real-time**: WebSockets (ws), HTTP Long Polling
- **Caching/State**: Redis
- **Load Testing**: k6
- **Containerization**: Docker & Docker Compose
- **Network Simulation**: iproute2 (tc/netem)

## 📋 Prerequisites

- Docker and Docker Compose
- Node.js (for running local scripts)
- k6 (optional, can be run via Docker)

## 🚦 Getting Started

### 1. Start the Environment
```bash
docker-compose up -d --build
```

### 2. Verify Health
```bash
docker-compose ps
# Ensure the 'app' container status is (healthy)
```

### 3. Visual Demo
Open your browser to test the real-time synchronization visually:
*   Navigate to: `http://localhost:3000/?doc_id=test-room`
*   Open the same link in a **second window** to see the synchronized cursors move in real-time.

## 📈 Performance Results
Detailed analysis, latency CDF graphs, and protocol jitter animations are available in the **[REPORT.md](./REPORT.md)**.

## 📊 Benchmarking

### Thundering Herd Simulation
Test the server's ability to handle 100 simultaneous concurrent long-pollers:
```bash
node scripts/thundering-herd.js
```

### Protocol Benchmarks (via k6)
Run protocol-specific latency tests using the provided k6 scripts:

**Long Polling:**
```bash
# PowerShell
Get-Content benchmarks/k6_lp.js | docker run --rm -i --network realtime-sync-benchmark-engine_default grafana/k6 run -
# Bash
cat benchmarks/k6_lp.js | docker run --rm -i --network realtime-sync-benchmark-engine_default grafana/k6 run -
```

**WebSockets:**
```bash
# PowerShell
Get-Content benchmarks/k6_ws.js | docker run --rm -i --network realtime-sync-benchmark-engine_default grafana/k6 run -
# Bash
cat benchmarks/k6_ws.js | docker run --rm -i --network realtime-sync-benchmark-engine_default grafana/k6 run -
```

## 🌐 Network Simulation

To test the system under realistic WAN conditions (100ms delay, 2% loss):

1. **Apply Degradation:**
   ```bash
   docker-compose exec app /bin/bash ./scripts/network-degrade.sh
   ```
2. **Verify with Ping:**
   ```bash
   docker-compose exec app ping -c 4 localhost
   ```
3. **Reset to Normal:**
   ```bash
   docker-compose exec app /bin/bash ./scripts/network-reset.sh
   ```

## 🔌 API Reference

### HTTP Endpoints
- `POST /api/event`: Send cursor updates.
  - Body: `{ "doc_id": string, "x": float, "y": float, "user_id": string, "sent_at": string }`
- `GET /api/events?doc_id=X`: Long Polling listener for room updates.
- `GET /health`: Health check endpoint.

### WebSocket
- **URL**: `ws://localhost:3000/ws?doc_id=X`
- **Protocol**: 
  - Send/Receive: `{ "type": "cursor", "x": float, "y": float, ... }`
  - Presence: `{ "type": "presence", "count": X }` (Automatic on connection change)
  - Heartbeat: Supports 30s ping/pong.

## 📁 Project Structure
- `src/server.js`: Core engine logic.
- `benchmarks/`: k6 load testing scripts.
- `scripts/`: Network simulation and thundering herd utilities.
- `docker-compose.yml`: Infrastructure orchestration.
- `submission.json`: Project configuration manifest.
