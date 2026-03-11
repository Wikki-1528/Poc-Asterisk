# CallMetrik Bridge

A Node.js/TypeScript WebSocket bridge that connects **Asterisk** (ulaw audio at 8kHz) to **Ultravox AI** (PCM16 audio at 8kHz) with an Express HTTP layer. Asterisk connects to this bridge over WebSocket — the bridge transparently creates an Ultravox session and relays audio in both directions in real time.

---

## Architecture

```
Asterisk ──(ulaw 8kHz WS)──► callmetrik-bridge ──(PCM16 8kHz WS)──► Ultravox AI
         ◄──────────────────────────────────────◄────────────────────
```

- Asterisk sends raw ulaw audio frames over a WebSocket connection to `/call`
- The bridge splits each incoming buffer into **160-byte ulaw chunks** (= 20ms at 8kHz), converts each chunk to PCM16, and forwards to Ultravox
- Ultravox responds with PCM16 audio which is converted back to ulaw and sent to Asterisk
- Each call is an isolated `CallSession` instance — sessions never share state

---

## Project Structure

```
callmetrik-bridge/
├── src/
│   ├── server.ts              # Express app + http.Server + IP allowlist + initBridge
│   ├── config.ts              # dotenv config with validation
│   ├── logger.ts              # pino logger (pretty in dev, JSON in prod)
│   ├── bridge/
│   │   ├── audio.ts           # ulaw ↔ PCM16 codec using alawmulaw
│   │   ├── ultravoxClient.ts  # Ultravox REST session creation + WS connection
│   │   ├── session.ts         # CallSession class — bidirectional audio relay
│   │   └── index.ts           # WebSocket server init (initBridge)
│   └── routes/
│       ├── health.ts          # GET /health
│       └── outbound.ts        # POST /call/outbound
├── ecosystem.config.js        # PM2 config for EC2 deploy
├── .env.example               # Environment variable template
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- Node.js 18+
- An [Ultravox API key](https://app.ultravox.ai)

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env

# 3. Fill in your Ultravox API key in .env
#    ULTRAVOX_API_KEY=your_key_here
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP + WS server port |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `ULTRAVOX_API_KEY` | **Yes** | — | Ultravox API key (throws on startup if missing) |
| `ULTRAVOX_BASE_URL` | No | `https://api.ultravox.ai` | Ultravox REST base URL |
| `CALLMETRIK_SECRET` | No | — | Shared secret for webhook validation (future use) |
| `ALLOWED_IPS` | No | — | Comma-separated list of allowed client IPs. Empty = allow all. Localhost always bypasses. |

---

## Running

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start
```

Expected startup output:
```
[INFO] WebSocket bridge initialised at path /call
[INFO] callmetrik-bridge listening on port 3000
```

---

## API Endpoints

### `GET /health`

Health check. Returns 200 with service info.

```json
{
  "status": "ok",
  "service": "callmetrik-bridge",
  "timestamp": "2026-03-11T08:40:00.000Z"
}
```

### `POST /call/outbound`

Queue an outbound call intent (logging only — AMI origination to be wired separately).

**Request body:**
```json
{
  "phoneNumber": "+919876543210",
  "systemPrompt": "You are a CallMetrik agent. Greet {{customerName}}.",
  "languageHint": "en-IN",
  "voice": "Mark",
  "templateContext": { "customerName": "John" }
}
```

**Responses:**
- `400` — `phoneNumber` is missing
- `200` — `{ "success": true, "message": "Outbound call queued", "callId": "uuid" }`

### `WebSocket /call`

Asterisk connects here to start an AI-bridged call session.

**Query parameters:**

| Param | Description |
|---|---|
| `agent_id` | Agent identifier (required for logging) |
| `language` | Language hint passed to Ultravox (default: `en-IN`) |
| `campaign_id` | Campaign identifier (optional, logged) |
| `customer_name` | Passed as `templateContext.customerName` to Ultravox |
| `system_prompt` | URL-encoded custom system prompt for this call |

**Example connection:**
```bash
npx wscat -c "ws://localhost:3000/call?agent_id=agent1&language=en-IN&customer_name=John&system_prompt=Hello%20%7B%7BcustomerName%7D%7D"
```

---

## Ultravox Integration Details

- **API endpoint:** `POST https://api.ultravox.ai/api/calls`
- **Auth:** `X-API-Key` header (not `Authorization: Bearer`)
- **Medium:** `serverWebSocket` with `inputSampleRate: 8000`, `outputSampleRate: 8000`
- **Response field for WS URL:** `joinUrl`
- **Default voice:** `Mark`
- **Default language:** `en-IN`
- **WS connection timeout:** 10 seconds

### Audio relay detail

Asterisk sends ulaw at 8kHz. The bridge processes it as follows:

```
Incoming ulaw buffer (variable size)
  → split into 160-byte chunks (= 20ms per chunk at 8kHz)
  → each chunk: ulawToPcm16()
  → send PCM chunk to Ultravox WebSocket
```

**160 bytes = 20ms** is critical — Ultravox uses consistent 20ms frames for interruption detection and voice activity. Sending larger buffers will break call timing.

### templateContext

`templateContext` values are only substituted by Ultravox if the `systemPrompt` contains `{{varName}}` placeholders. Example:

```
"You are a CallMetrik agent. The customer's name is {{customerName}}."
```

Plain-text prompts silently ignore `templateContext`.

---

## Session Lifecycle

1. Asterisk connects to `ws://host/call?agent_id=...`
2. `CallSession` is created with a `crypto.randomUUID()` call ID
3. `createUltravoxSession()` POSTs to Ultravox REST API → gets `joinUrl`
4. `connectToUltravoxSession()` opens WebSocket to `joinUrl`
5. Bidirectional audio relay runs until either socket closes
6. `session.end()` closes both sockets, logs call duration, removes from active sessions map
7. Double-call to `end()` is guarded by a `started` boolean flag

---

## EC2 Deployment

### Build and start with PM2

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 logs callmetrik-bridge
```

### Deploy update workflow

```bash
# On EC2
git pull
npm run build
pm2 restart callmetrik-bridge
pm2 logs
```

### Monitor

```bash
pm2 monit          # live CPU/memory
pm2 logs           # tail logs
pm2 list           # status of all processes
```

---

## Pre-Deployment Checklist

| Test | Pass Criteria |
|---|---|
| Health check | `GET /health` returns 200 JSON |
| WSS reachable | `wscat` connects without TLS error |
| Inbound call | AI agent greets caller within 2s |
| Outbound call | Customer hears AI agent on pickup |
| Audio quality | No choppy audio, latency under 800ms |
| Concurrent calls | 3 simultaneous calls work independently |
| Hangup cleanup | PM2 logs show session closed, no zombie sessions |
| Crash recovery | Kill node process → PM2 restarts within 5s |
| Memory | PM2 monit shows under 300MB under load |

---

## Local Testing (Before Deploy)

Run these tests in order. Each one validates a layer of the stack.

### Step 1 — Start the server

```bash
# Fill in your API key first
# Edit .env: ULTRAVOX_API_KEY=your_key_here

npm run dev
```

Expected output:
```
[INFO] WebSocket bridge initialised at path /call
[INFO] callmetrik-bridge listening on port 3000
```

If it crashes with `Missing required environment variable: ULTRAVOX_API_KEY` — your `.env` key is blank.

---

### Step 2 — Health check

```bash
curl http://localhost:3000/health
```

Expected:
```json
{ "status": "ok", "service": "callmetrik-bridge", "timestamp": "..." }
```

---

### Step 3 — WebSocket connection test

```bash
npx wscat -c "ws://localhost:3000/call?agent_id=test&language=en-IN&customer_name=John"
```

Expected in server logs:
```
[INFO] New Asterisk WS connection { callId: "...", agentId: "test", ... }
[INFO] CallSession created { callId: "..." }
[INFO] Creating Ultravox session { agentId: "test" }
[INFO] Ultravox session created { agentId: "test", joinUrl: "wss://..." }
[INFO] Bidirectional audio relay active { callId: "..." }
```

If you see `joinUrl missing from Ultravox response` — check your `ULTRAVOX_API_KEY` value.  
If you see `Ultravox WS connection timeout` — Ultravox returned a joinUrl but couldn't open the WS (check firewall/internet).

---

### Step 4 — Send test audio (simulated Asterisk frame)

In the wscat session, type anything and press Enter — wscat sends text frames. For a real audio test you need to send binary ulaw frames. Use this Node.js snippet:

```js
// test-audio.js — run with: node test-audio.js
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/call?agent_id=audio-test&language=en-IN');

ws.on('open', () => {
  console.log('Connected');
  // Send 160 bytes of silence (ulaw silence = 0xFF)
  const silenceFrame = Buffer.alloc(160, 0xFF);
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(silenceFrame);
  }, 20); // every 20ms = 8kHz ulaw
});

ws.on('message', (data) => {
  console.log('Received audio from Ultravox:', data.length, 'bytes');
});

ws.on('close', () => console.log('Disconnected'));
ws.on('error', (e) => console.error('Error:', e.message));
```

```bash
node test-audio.js
```

Expected: after a moment you should see `Received audio from Ultravox: XXX bytes` lines — this confirms the full loop works.

---

### Step 5 — Outbound route test

```bash
curl -X POST http://localhost:3000/call/outbound \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+919876543210","languageHint":"en-IN","voice":"Mark"}'
```

Expected:
```json
{ "success": true, "message": "Outbound call queued", "callId": "uuid" }
```

Missing `phoneNumber`:
```bash
curl -X POST http://localhost:3000/call/outbound -H "Content-Type: application/json" -d '{}'
# → 400: { "error": "phoneNumber is required" }
```

---

### Step 6 — Hangup / cleanup test

Connect with wscat, wait for relay to activate, then press `Ctrl+C` to disconnect.

Expected in server logs:
```
[INFO] Asterisk WS closed { callId: "..." }
[INFO] CallSession ended { callId: "...", durationMs: XXXX }
```

No zombie sessions — the session must be removed from the active map.

---

### Step 7 — IP allowlist test (optional)

Set `ALLOWED_IPS=1.2.3.4` in `.env`, restart the server, then:

```bash
curl http://localhost:3000/health
# → 200 (localhost is always bypassed)
```

From any other IP it would return `403 { "error": "Forbidden" }`.

Reset `ALLOWED_IPS=` (empty) when done.

---

## EC2 Deployment

### Prerequisites on EC2

```bash
# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
sudo npm install -g pm2

# Git
sudo apt-get install -y git
```

---

### First-time deploy

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_ORG/callmetrik-bridge.git
cd callmetrik-bridge

# 2. Install dependencies
npm install

# 3. Create and fill .env
cp .env.example .env
nano .env
# Set: ULTRAVOX_API_KEY=your_key_here
# Set: NODE_ENV=production
# Set: PORT=3000
# Set: ALLOWED_IPS=  (leave empty or add Asterisk server IP)

# 4. Build TypeScript
npm run build

# 5. Start with PM2
pm2 start ecosystem.config.js

# 6. Save PM2 process list (auto-restart on reboot)
pm2 save

# 7. Enable PM2 on system startup
pm2 startup
# Run the command it prints (e.g. sudo env PATH=... pm2 startup systemd ...)
```

---

### Update deploy (subsequent pushes)

```bash
# SSH into EC2, then:
cd callmetrik-bridge
git pull
npm install          # only needed if package.json changed
npm run build
pm2 restart callmetrik-bridge
pm2 logs callmetrik-bridge --lines 50
```

---

### Monitor on EC2

```bash
pm2 list                           # process status
pm2 logs callmetrik-bridge         # live log tail
pm2 monit                          # live CPU + memory dashboard
pm2 show callmetrik-bridge         # full process details
```

---

### Reverse proxy with Nginx (for WSS / HTTPS)

If you're exposing the bridge over `wss://` (required for production), set up Nginx:

```nginx
server {
    listen 443 ssl;
    server_name bridge.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/bridge.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bridge.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
    }
}
```

The `proxy_set_header Upgrade` and `Connection "upgrade"` lines are **required** for WebSocket proxying. Without them, WS connections will fail.

Get a free TLS cert:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d bridge.yourdomain.com
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server and routing |
| `ws` | WebSocket server (Asterisk) and client (Ultravox) |
| `axios` | HTTP client for Ultravox REST API |
| `alawmulaw` | ulaw ↔ PCM16 audio codec |
| `pino` + `pino-pretty` | Structured logging |
| `dotenv` | Environment variable loading |

---

## Troubleshooting

**Server won't start — `Missing required environment variable: ULTRAVOX_API_KEY`**
→ Add your key to `.env`

**`EADDRINUSE: address already in use :::3000`**
→ Another process is on port 3000. Find it: `netstat -ano | findstr :3000` then kill: `taskkill /PID <pid> /F`

**`joinUrl missing from Ultravox response`**
→ The full Ultravox response body is logged at ERROR level. Check `pm2 logs` to see what the API returned. Usually means an invalid API key or malformed request body.

**`Ultravox WS connection timeout`**
→ The `joinUrl` was returned but the WS handshake didn't complete within 10s. Check network/firewall rules on EC2 for outbound WSS to `*.ultravox.ai`.

**Choppy audio / bad interruption detection**
→ Verify Asterisk is sending exactly 160-byte ulaw frames (20ms). If frames are larger, the bridge will split them — but if Asterisk is sending malformed or non-binary frames, check Asterisk AGI/ARI configuration.