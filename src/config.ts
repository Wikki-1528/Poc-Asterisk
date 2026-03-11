import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  ULTRAVOX_API_KEY: requireEnv('ULTRAVOX_API_KEY'),
  ULTRAVOX_BASE_URL: process.env.ULTRAVOX_BASE_URL ?? 'https://api.ultravox.ai',
  CALLMETRIK_SECRET: process.env.CALLMETRIK_SECRET ?? '',
  ALLOWED_IPS: process.env.ALLOWED_IPS
    ? process.env.ALLOWED_IPS.split(',').map((ip) => ip.trim()).filter(Boolean)
    : [],
};
