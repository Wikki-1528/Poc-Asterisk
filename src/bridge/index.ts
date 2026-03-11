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

    const agentId = parsedUrl.searchParams.get('agent_id') ?? '';
    const languageHint = parsedUrl.searchParams.get('language') ?? 'en-IN';
    const campaignId = parsedUrl.searchParams.get('campaign_id') ?? undefined;
    const customerName = parsedUrl.searchParams.get('customer_name') ?? undefined;
    const rawSystemPrompt = parsedUrl.searchParams.get('system_prompt');
    const systemPrompt = rawSystemPrompt ? decodeURIComponent(rawSystemPrompt) : undefined;

    const callId = crypto.randomUUID();

    const options: UltravoxSessionOptions = {
      agentId,
      languageHint,
      campaignId,
      systemPrompt,
      templateContext: customerName ? { customerName } : undefined,
    };

    logger.info({ callId, agentId, languageHint, campaignId, customerName }, 'New Asterisk WS connection');

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
