import http from 'http';
import { URL } from 'url';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import logger from '../logger';
import { CallSession } from './session';
import { UltravoxSessionOptions } from './ultravoxClient';

export function initBridge(server: http.Server): void {
  const activeSessions = new Map<string, CallSession>();

  const wss = new WebSocketServer({ server, path: '/call' });

  wss.on('connection', (ws, req) => {
    const rawUrl = req.url ?? '';
    const parsedUrl = new URL(rawUrl, 'ws://localhost');

    const voice = parsedUrl.searchParams.get('voice') ?? undefined;
    const languageHint = parsedUrl.searchParams.get('language') ?? 'en-IN';
    const customerName = parsedUrl.searchParams.get('customer_name') ?? undefined;
    const rawSystemPrompt = parsedUrl.searchParams.get('system_prompt');
    const systemPrompt = rawSystemPrompt ? decodeURIComponent(rawSystemPrompt) : undefined;

    const callId = crypto.randomUUID();

    const options: UltravoxSessionOptions = {
      voice,
      languageHint,
      systemPrompt,
      customerName,
    };

    logger.info({ callId, voice, languageHint, customerName }, 'New Asterisk WS connection');

    const session = new CallSession(callId, ws, options, activeSessions);
    activeSessions.set(callId, session);

    session.start().catch((err) => {
      logger.error({ callId, err }, 'Session start failed');
      activeSessions.delete(callId);
    });

    ws.on('close', () => {
      activeSessions.delete(callId);
    });
  });

  logger.info('WebSocket bridge initialised at path /call');
}
