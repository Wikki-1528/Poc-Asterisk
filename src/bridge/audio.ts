import { mulaw } from 'alawmulaw';

/** Native Asterisk sample rate (8kHz ulaw) */
export const SAMPLE_RATE = 8000;

/**
 * Converts a ulaw-encoded Buffer to 16-bit signed PCM.
 * Input: ulaw samples at 8kHz (1 byte per sample)
 * Output: PCM16 buffer at 8kHz (2 bytes per sample, little-endian)
 */
export function ulawToPcm16(buffer: Buffer): Buffer {
  const samples = mulaw.decode(buffer);
  const pcm = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    pcm.writeInt16LE(samples[i], i * 2);
  }
  return pcm;
}

/**
 * Converts 16-bit signed PCM back to ulaw encoding.
 * Input: PCM16 buffer at 8kHz (2 bytes per sample, little-endian)
 * Output: ulaw buffer at 8kHz (1 byte per sample)
 */
export function pcm16ToUlaw(buffer: Buffer): Buffer {
  const sampleCount = Math.floor(buffer.length / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buffer.readInt16LE(i * 2);
  }
  return Buffer.from(mulaw.encode(samples));
}
