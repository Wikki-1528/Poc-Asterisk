import axios from 'axios';
import WebSocket from 'ws';
import { config } from '../config';
import logger from '../logger';

export interface UltravoxSessionOptions {
  agentId: string;
  systemPrompt?: string;
  voice?: string;
  languageHint?: string;
  campaignId?: string;
  templateContext?: Record<string, string>;
}

export async function createUltravoxSession(options: UltravoxSessionOptions): Promise<string> {
  const url = `${config.ULTRAVOX_BASE_URL}/api/calls`;

  const resolvedPrompt = options.templateContext
    ? (options.systemPrompt ?? 'You are a helpful CallMetrik voice agent.').replace(
        /\{\{(\w+)\}\}/g,
        (_, key) => options.templateContext?.[key] ?? `{{${key}}}`
      )
    : (options.systemPrompt ?? 'You are a helpful CallMetrik voice agent.');

  const body = {
    systemPrompt: resolvedPrompt,
    voice: options.voice ?? 'Mark',
    languageHint: options.languageHint ?? 'en-IN',
    medium: {
      serverWebSocket: {
        inputSampleRate: 8000,
        outputSampleRate: 8000,
      },
    },
  };

  logger.info({ agentId: options.agentId, campaignId: options.campaignId }, 'Creating Ultravox session');

  let response;
  try {
    response = await axios.post(url, body, {
      headers: {
        'X-API-Key': config.ULTRAVOX_API_KEY,
        'Content-Type': 'application/json',
      },
    });
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      logger.error({
        status: err.response?.status,
        errorBody: err.response?.data,
        requestBody: body,
      }, 'Ultravox API call failed');
      throw new Error(`Ultravox API error ${err.response?.status}: ${JSON.stringify(err.response?.data)}`);
    }
    throw err;
  }

  const joinUrl: string | undefined = response.data?.joinUrl;

  if (!joinUrl) {
    logger.error({ responseData: response.data }, 'joinUrl missing from Ultravox response');
    throw new Error('joinUrl missing from Ultravox response');
  }

  logger.info({ agentId: options.agentId, joinUrl }, 'Ultravox session created');
  return joinUrl;
}

export async function connectToUltravoxSession(joinUrl: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(joinUrl);
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error('Ultravox WS connection timeout'));
      }
    }, 10_000);

    ws.on('open', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(ws);
      }
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}
