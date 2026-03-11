import axios from 'axios';
import WebSocket from 'ws';
import { config } from '../config';
import logger from '../logger';

export interface UltravoxSessionOptions {
  systemPrompt?: string;
  voice?: string;
  languageHint?: string;
  customerName?: string;
}

export async function createUltravoxSession(options: UltravoxSessionOptions): Promise<string> {
  const url = `${config.ULTRAVOX_BASE_URL}/api/calls`;

  const basePrompt = options.systemPrompt ?? 'You are a helpful CallMetrik voice agent.';
  const resolvedPrompt = options.customerName
    ? basePrompt.replace(/\{\{customerName\}\}/g, options.customerName)
    : basePrompt;

  const body: Record<string, unknown> = {
    systemPrompt: resolvedPrompt,
    languageHint: options.languageHint ?? 'en-IN',
    medium: {
      serverWebSocket: {
        inputSampleRate: 8000,
        outputSampleRate: 8000,
      },
    },
  };

  if (options.voice) {
    body.voice = options.voice;
  }

  logger.info({ voice: options.voice, languageHint: options.languageHint }, 'Creating Ultravox session');

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

  logger.info({ joinUrl }, 'Ultravox session created');
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
