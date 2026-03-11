# CallMetrik Bridge

A Node.js/TypeScript WebSocket bridge connecting **Asterisk** (ulaw audio at 8kHz) to **Ultravox AI** (PCM16 audio at 8kHz). Deployed and running on AWS EC2.

## Live Server

| | |
|---|---|
| **EC2 Host** | `13.60.174.139` |
| **HTTP Port** | `3000` |
| **WebSocket endpoint** | `ws://13.60.174.139:3000/call` |
| **Health check** | `http://13.60.174.139:3000/health` |
| **Outbound API** | `http://13.60.174.139:3000/call/outbound` |
| **PM2 process** | `callmetrik-bridge` (cluster mode, auto-restart on reboot) |

> **Note:** Port 3000 must be open in the EC2 Security Group for inbound TCP. If using WSS (secure WebSocket), set up Nginx + SSL — see the Nginx section below.

---

## Architecture

```
Asterisk ──(ulaw 8kHz WS)──► callmetrik-bridge ──(PCM16 8kHz WS)──► Ultravox AI
         ◄──────────────────────────────────────◄────────────────────
```

- Asterisk connects to `/call` over WebSocket, sending raw **ulaw audio at 8kHz**
- The bridge splits each buffer into **160-byte ulaw chunks** (20ms), converts each to PCM16, and forwards to Ultravox
- Ultravox responds with PCM16 audio which is converted back to ulaw and sent to Asterisk
- Each call is an isolated `CallSession` — no shared state between calls
- A new Ultravox AI session is created per call via REST API, then connected over WebSocket

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

## API Reference

### `GET /health`

Health check.

```bash
curl http://13.60.174.139:3000/health
```

Response:
```json
{ "status": "ok", "service": "callmetrik-bridge", "timestamp": "2026-03-11T09:41:04.932Z" }
```

---

### `POST /call/outbound`

Logs an outbound call intent. AMI origination to be wired separately.

```bash
curl -X POST http://13.60.174.139:3000/call/outbound \
  -H 'Content-Type: application/json' \
  -d '{"phoneNumber":"+919876543210","voice":"Mark","languageHint":"en-IN","customerName":"John","systemPrompt":"You are a helpful agent."}'
```

**Request body fields:**

| Field | Required | Description |
|---|---|---|
| `phoneNumber` | **Yes** | Destination phone number |
| `systemPrompt` | No | AI agent instructions |
| `voice` | No | Ultravox voice name (e.g. `Mark`) |
| `languageHint` | No | Language code (default: `en-IN`) |
| `customerName` | No | Customer name — replaces `{{customerName}}` in systemPrompt |

**Responses:**
- `400` — `{ "error": "phoneNumber is required" }`
- `200` — `{ "success": true, "message": "Outbound call queued", "callId": "uuid" }`

---

### `WebSocket ws://13.60.174.139:3000/call`

This is the main endpoint. Asterisk connects here to start an AI-bridged call.

**Connection URL format:**
```
ws://13.60.174.139:3000/call?voice=<voice>&language=<lang>&customer_name=<name>&system_prompt=<url-encoded-prompt>
```

**Query parameters:**

| Param | Required | Default | Description |
|---|---|---|---|
| `system_prompt` | No | `You are a helpful CallMetrik voice agent.` | URL-encoded AI instructions for this call |
| `voice` | No | Ultravox default | Ultravox built-in voice name (e.g. `Mark`, `Emily`) |
| `language` | No | `en-IN` | Language hint (e.g. `en-US`, `en-IN`, `hi-IN`) |
| `customer_name` | No | — | Replaces `{{customerName}}` placeholder in `system_prompt` |

**Example — basic connection:**
```bash
npx wscat -c "ws://13.60.174.139:3000/call"
```

**Example — with voice and language:**
```bash
npx wscat -c "ws://13.60.174.139:3000/call?voice=Mark&language=en-IN"
```

**Example — with custom system prompt and customer name:**
```bash
npx wscat -c "ws://13.60.174.139:3000/call?voice=Mark&language=en-IN&customer_name=John&system_prompt=You%20are%20a%20CallMetrik%20agent.%20The%20customer%20is%20%7B%7BcustomerName%7D%7D."
```

Expected server logs after connecting:
```json
{ "msg": "New Asterisk WS connection", "callId": "uuid", "voice": "Mark", "languageHint": "en-IN" }
{ "msg": "Creating Ultravox session", "voice": "Mark", "languageHint": "en-IN" }
{ "msg": "Ultravox session created", "joinUrl": "wss://..." }
{ "msg": "Bidirectional audio relay active", "callId": "uuid" }
```

---

## Ultravox Integration Details

| | |
|---|---|
| **API endpoint** | `POST https://api.ultravox.ai/api/calls` |
| **Auth header** | `X-API-Key` (not `Authorization: Bearer`) |
| **Medium** | `serverWebSocket` — `inputSampleRate: 8000`, `outputSampleRate: 8000` |
| **Response field** | `joinUrl` — WebSocket URL to connect for audio |
| **WS timeout** | 10 seconds |

### Request body sent to Ultravox

```json
{
  "systemPrompt": "You are a helpful CallMetrik voice agent.",
  "voice": "Mark",
  "languageHint": "en-IN",
  "medium": {
    "serverWebSocket": {
      "inputSampleRate": 8000,
      "outputSampleRate": 8000
    }
  }
}
```

> `voice` is only sent if provided — omitting it lets Ultravox use its default.

### `{{customerName}}` substitution

Templates are resolved **locally** before sending to Ultravox (not by the Ultravox API). Example:

```
system_prompt = "Hello {{customerName}}, how can I help?"
customer_name = "John"
→ sent to Ultravox: "Hello John, how can I help?"
```

### Audio framing

```
Asterisk sends: ulaw buffer (any size)
  → split into 160-byte chunks (= 20ms at 8kHz)
  → ulawToPcm16() each chunk
  → send to Ultravox WS

Ultravox sends: PCM16 buffer
  → pcm16ToUlaw()
  → send to Asterisk WS
```

**160 bytes = 20ms** is the correct frame size. Ultravox uses 20ms frames for voice activity and interruption detection.

---

## Session Lifecycle

1. Asterisk opens `ws://13.60.174.139:3000/call?voice=...&system_prompt=...`
2. Bridge assigns a `callId` (UUID) and creates a `CallSession`
3. `createUltravoxSession()` → `POST /api/calls` → receives `joinUrl`
4. `connectToUltravoxSession()` → opens WebSocket to `joinUrl` (10s timeout)
5. Bidirectional audio relay begins — both WS connections bridged in real time
6. When either socket closes → `session.end()` closes the other, logs `durationMs`, removes from active map
7. Guard flag prevents double-close

---

## EC2 Deployment

### Current status

The service is **live** on `13.60.174.139:3000`. PM2 is configured to auto-restart on crash and survive reboots.

```bash
pm2 list
# callmetrik-bridge | cluster | online | 0 restarts | ~60mb
```

---

### SSH access

```bash
ssh -i "C:\Users\LENOVO\Downloads\callmetrik.pem" ubuntu@13.60.174.139
```

---

### Monitor

```bash
pm2 list                            # process status
pm2 logs callmetrik-bridge          # live log tail
pm2 logs callmetrik-bridge --lines 50   # last 50 lines
pm2 monit                           # live CPU + memory
```

---

### Deploy an update

```bash
# SSH into EC2 first, then:
cd callmetrik-bridge
git pull
npm install          # only if package.json changed
npm run build
pm2 restart callmetrik-bridge
pm2 logs callmetrik-bridge --lines 20
```

---

### First-time setup (for new EC2)

```bash
# 1. Install Node 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install PM2
sudo npm install -g pm2

# 3. Clone and install
git clone https://github.com/Wikki-1528/Poc-Asterisk.git callmetrik-bridge
cd callmetrik-bridge
npm install

# 4. Configure .env
cat > .env << EOF
NODE_ENV=production
PORT=3000
ULTRAVOX_API_KEY=your_key_here
ULTRAVOX_BASE_URL=https://api.ultravox.ai
CALLMETRIK_SECRET=
ALLOWED_IPS=
EOF

# 5. Build and start
npm run build
pm2 start ecosystem.config.js
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

---

## Asterisk Configuration

To connect Asterisk to the bridge, use the ARI (Asterisk REST Interface) or AGI with a WebSocket client. The bridge expects:

- **Protocol:** WebSocket (`ws://` or `wss://`)
- **Path:** `/call`
- **Audio format:** ulaw (G.711 μ-law), 8kHz, 8-bit, mono
- **Frame size:** 160 bytes (20ms) — send at 20ms intervals

**Example Asterisk dialplan (ARI stasis app):**
```
[from-internal]
exten => _X.,1,NoOp(Starting CallMetrik bridge)
 same => n,Stasis(callmetrik-bridge)
 same => n,Hangup()
```

**WebSocket URL to configure in your ARI app:**
```
ws://13.60.174.139:3000/call?voice=Mark&language=en-IN&system_prompt=You%20are%20a%20helpful%20agent
```

---

## Testing

### 1. Health check
```bash
curl http://13.60.174.139:3000/health
# Expected: {"status":"ok","service":"callmetrik-bridge","timestamp":"..."}
```

### 2. WebSocket connect test
```bash
npx wscat -c "ws://13.60.174.139:3000/call?voice=Mark&language=en-IN&customer_name=John"
# Expected: Connected (press CTRL+C to quit)
```

Check PM2 logs immediately after connecting:
```bash
# SSH into EC2:
pm2 logs callmetrik-bridge --lines 20
```

Expected log output:
```json
{"msg":"New Asterisk WS connection","callId":"...","voice":"Mark"}
{"msg":"Creating Ultravox session"}
{"msg":"Ultravox session created","joinUrl":"wss://..."}
{"msg":"Bidirectional audio relay active","callId":"..."}
```

### 3. Full audio loop test (from local machine)
```bash
node test-audio.js
# Expected:
# [PASS] WebSocket connected
# [PASS] First audio frame received from Ultravox (160 bytes)
# Frames sent: 282 | Frames received: 202
# [PASS] Full audio loop confirmed
```

### 4. Outbound route test (from inside EC2)
```bash
ssh -i "key.pem" ubuntu@13.60.174.139
curl -X POST http://localhost:3000/call/outbound \
  -H 'Content-Type: application/json' \
  -d '{"phoneNumber":"+919999999999","voice":"Mark"}'
# Expected: {"success":true,"message":"Outbound call queued","callId":"..."}
```

---

## Nginx Reverse Proxy (for WSS)

Required for production — enables `wss://` (secure WebSocket) and `https://`.

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain.com
```

`/etc/nginx/sites-available/callmetrik`:
```nginx
server {
    listen 443 ssl;
    server_name your.domain.com;

    ssl_certificate     /etc/letsencrypt/live/your.domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your.domain.com/privkey.pem;

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

After enabling:
```bash
sudo ln -s /etc/nginx/sites-available/callmetrik /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Asterisk then connects to:
```
wss://your.domain.com/call?voice=Mark&language=en-IN
```

---

## Pre-Go-Live Checklist

| Test | Expected |
|---|---|
| `GET /health` | `{"status":"ok"}` |
| `wscat` connects | `Connected` — no error |
| PM2 logs show `Ultravox session created` | `joinUrl` present in log |
| PM2 logs show `Bidirectional audio relay active` | Relay running |
| `test-audio.js` receives frames back | `Frames received > 0` |
| Hangup → PM2 logs `CallSession ended` | `durationMs` logged, no zombie |
| EC2 reboot → `pm2 list` shows `online` | Auto-restart working |

---

## Local Development

```bash
# Clone
git clone https://github.com/Wikki-1528/Poc-Asterisk.git callmetrik-bridge
cd callmetrik-bridge

# Install
npm install

# Configure
cp .env.example .env
# Edit .env: set ULTRAVOX_API_KEY=your_key_here

# Run with hot reload
npm run dev
```

Expected startup:
```
[INFO] WebSocket bridge initialised at path /call
[INFO] callmetrik-bridge listening on port 3000
```

Run the full audio loop test:
```bash
node test-audio.js
# [PASS] WebSocket connected
# [PASS] First audio frame received from Ultravox (160 bytes)
# [PASS] Full audio loop confirmed — Ultravox is responding with audio
```

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

**`Missing required environment variable: ULTRAVOX_API_KEY`**
→ `.env` key is blank. Add it and restart: `pm2 restart callmetrik-bridge`

**`EADDRINUSE :::3000`** (local dev only)
→ `netstat -ano | findstr :3000` → `taskkill /PID <pid> /F`

**`Ultravox API error 400`**
→ Check `pm2 logs` for `errorBody`. Usually an invalid field in the request. The `errorBody` is logged.

**`joinUrl missing from Ultravox response`**
→ API key is wrong or expired. Check `pm2 logs callmetrik-bridge` for `errorBody`.

**`Ultravox WS connection timeout`**
→ EC2 outbound TCP to `*.ultravox.ai` is blocked. Check Security Group outbound rules — allow all outbound or specifically port 443.

**WebSocket connects but no audio back from Ultravox**
→ Normal if the AI hasn't spoken yet. It speaks when VAD detects silence/speech from the caller. Send actual audio (not silence) to trigger a response.

**Choppy audio**
→ Asterisk must send exactly 160-byte ulaw frames every 20ms. Check ARI/AGI audio format configuration.

**`pm2 logs` shows JSON, not pretty output**
→ Expected in production (`NODE_ENV=production`). Use `pm2 logs` for raw JSON, or `jq` to pretty print: `pm2 logs callmetrik-bridge | jq .`