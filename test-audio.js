// test-audio.js — full audio loop test
// Simulates Asterisk sending ulaw silence frames and checks Ultravox responds
const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3000/call?agent_id=audio-test&language=en-IN&customer_name=TestUser';
const FRAME_SIZE = 160;       // 160 bytes = 20ms at 8kHz ulaw
const FRAME_INTERVAL_MS = 20; // send every 20ms
const TEST_DURATION_MS = 8000; // run for 8 seconds

console.log('Connecting to', WS_URL);
const ws = new WebSocket(WS_URL);

let framesSent = 0;
let framesReceived = 0;
let intervalId = null;

ws.on('open', () => {
  console.log('[PASS] WebSocket connected');

  // ulaw silence value is 0xFF
  const silenceFrame = Buffer.alloc(FRAME_SIZE, 0xFF);

  intervalId = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(silenceFrame);
      framesSent++;
    }
  }, FRAME_INTERVAL_MS);

  // Stop after TEST_DURATION_MS
  setTimeout(() => {
    if (intervalId) clearInterval(intervalId);
    console.log('\n--- Test Results ---');
    console.log(`Frames sent    : ${framesSent}`);
    console.log(`Frames received: ${framesReceived}`);
    if (framesReceived > 0) {
      console.log('[PASS] Full audio loop confirmed — Ultravox is responding with audio');
    } else {
      console.log('[WARN] No audio received from Ultravox yet — this may be normal if the agent has not spoken yet.');
      console.log('       Check server logs for "Bidirectional audio relay active".');
    }
    ws.close();
  }, TEST_DURATION_MS);
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    framesReceived++;
    if (framesReceived === 1) {
      console.log(`[PASS] First audio frame received from Ultravox (${data.length} bytes)`);
    }
  }
});

ws.on('error', (err) => {
  console.error('[FAIL] WebSocket error:', err.message);
  console.error('       Is the server running? (npm run dev)');
  process.exit(1);
});

ws.on('close', () => {
  console.log('[INFO] Connection closed. Test complete.');
});
