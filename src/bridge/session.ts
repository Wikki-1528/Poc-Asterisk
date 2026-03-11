import WebSocket from 'ws';
import logger from '../logger';
import { createUltravoxSession, connectToUltravoxSession, UltravoxSessionOptions } from './ultravoxClient';
import { ulawToPcm16, pcm16ToUlaw } from './audio';

const ULAW_CHUNK_BYTES = 160;

export class CallSession {
  private readonly callId: string;
  private readonly asteriskWs: WebSocket;
  private readonly options: UltravoxSessionOptions;
  private readonly activeSessions: Map<string, CallSession>;

  private ultravoxWs: WebSocket | null = null;
  private started = false;
  private startTime = 0;

  constructor(
    callId: string,
    asteriskWs: WebSocket,
    options: UltravoxSessionOptions,
    activeSessions: Map<string, CallSession>
  ) {
    this.callId = callId;
    this.asteriskWs = asteriskWs;
    this.options = options;
    this.activeSessions = activeSessions;
    logger.info({ callId }, 'CallSession created');
  }

  async start(): Promise<void> {
    this.startTime = Date.now();

    const joinUrl = await createUltravoxSession(this.options);
    this.ultravoxWs = await connectToUltravoxSession(joinUrl);

    logger.info({ callId: this.callId }, 'Bidirectional audio relay active');

    this.asteriskWs.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (!isBinary || !this.ultravoxWs || this.ultravoxWs.readyState !== WebSocket.OPEN) return;

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

      for (let offset = 0; offset < buf.length; offset += ULAW_CHUNK_BYTES) {
        const chunk = buf.subarray(offset, offset + ULAW_CHUNK_BYTES);
        const pcm = ulawToPcm16(chunk);
        this.ultravoxWs.send(pcm);
      }
    });

    this.ultravoxWs.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (!isBinary || this.asteriskWs.readyState !== WebSocket.OPEN) return;

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const ulaw = pcm16ToUlaw(buf);
      this.asteriskWs.send(ulaw);
    });

    this.asteriskWs.on('close', () => {
      logger.info({ callId: this.callId }, 'Asterisk WS closed');
      this.end();
    });

    this.asteriskWs.on('error', (err) => {
      logger.error({ callId: this.callId, err }, 'Asterisk WS error');
      this.end();
    });

    this.ultravoxWs.on('close', () => {
      logger.info({ callId: this.callId }, 'Ultravox WS closed');
      this.end();
    });

    this.ultravoxWs.on('error', (err) => {
      logger.error({ callId: this.callId, err }, 'Ultravox WS error');
      this.end();
    });
  }

  end(): void {
    if (this.started) return;
    this.started = true;

    const durationMs = Date.now() - this.startTime;
    logger.info({ callId: this.callId, durationMs }, 'CallSession ended');

    if (this.asteriskWs.readyState === WebSocket.OPEN) {
      this.asteriskWs.close();
    }
    if (this.ultravoxWs && this.ultravoxWs.readyState === WebSocket.OPEN) {
      this.ultravoxWs.close();
    }

    this.activeSessions.delete(this.callId);
  }
}
