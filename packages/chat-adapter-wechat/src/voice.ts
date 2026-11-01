/**
 * Inbound WeChat voice decoding.
 *
 * iLink delivers voice items as raw SILK v3 (`voice_item.encode_type = 6`),
 * which no browser `<audio>` element and almost no LLM audio input accepts.
 * We decode it to 16-bit PCM WAV right after download so every downstream
 * consumer (file storage, chat UI player, audio-capable models) gets a
 * format it can actually play. See protocol-spec.md §5.6 / §8.5.
 */
import type { VoiceItem } from './types';

/** Protocol default when `voice_item.sample_rate` is absent. */
export const DEFAULT_WECHAT_VOICE_SAMPLE_RATE = 24_000;

const SILK_MAGIC = Buffer.from('#!SILK_V3', 'ascii');

/** `voice_item.encode_type` values from the iLink protocol (§5.6). */
export const WechatVoiceEncodeType = {
  AMR: 5,
  MP3: 7,
  SILK: 6,
} as const;

export interface DecodedWechatVoice {
  buffer: Buffer;
  /** Playback length in milliseconds when the decoder reports one. */
  durationMs?: number;
  mimeType: string;
  name: string;
}

const TENCENT_SILK_PREFIX = 0x02;

const hasSilkMagicAt = (input: Buffer, offset: number): boolean =>
  input.length >= offset + SILK_MAGIC.length &&
  input.subarray(offset, offset + SILK_MAGIC.length).equals(SILK_MAGIC);

/**
 * SILK v3 streams come in two shapes: the bare `#!SILK_V3` header, and the
 * Tencent variant with a single `0x02` byte in front of it (what WeChat/QQ
 * produce). silk-wasm's decoder only accepts the Tencent form, so make sure
 * the prefix byte is present before handing the stream over.
 */
export function normalizeSilkStream(input: Buffer): Buffer {
  if (input[0] === TENCENT_SILK_PREFIX && hasSilkMagicAt(input, 1)) return input;
  if (hasSilkMagicAt(input, 0)) return Buffer.concat([Buffer.from([TENCENT_SILK_PREFIX]), input]);
  return input;
}

export function isSilkStream(input: Buffer): boolean {
  return hasSilkMagicAt(input, 0) || (input[0] === TENCENT_SILK_PREFIX && hasSilkMagicAt(input, 1));
}

/**
 * Wrap mono 16-bit little-endian PCM in a 44-byte RIFF/WAVE header.
 */
export function pcmS16ToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.byteLength, 40);

  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

const resolveSampleRate = (voiceItem?: VoiceItem): number => {
  const rate = voiceItem?.sample_rate;
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
    ? rate
    : DEFAULT_WECHAT_VOICE_SAMPLE_RATE;
};

/**
 * Turn downloaded voice bytes into a playable attachment.
 *
 * - SILK (by `encode_type` or magic header) → decoded to `audio/wav`.
 * - MP3 passes through as `audio/mpeg`.
 * - Anything else, or a SILK stream the decoder rejects, falls back to the
 *   raw bytes labelled `audio/silk` so the message still goes through; the
 *   caller may log the `error` for diagnostics.
 */
export async function decodeWechatVoice(
  input: Buffer,
  voiceItem?: VoiceItem,
  onError?: (error: unknown) => void,
): Promise<DecodedWechatVoice> {
  if (voiceItem?.encode_type === WechatVoiceEncodeType.MP3) {
    return { buffer: input, mimeType: 'audio/mpeg', name: 'voice.mp3' };
  }

  const looksLikeSilk =
    isSilkStream(input) || voiceItem?.encode_type === WechatVoiceEncodeType.SILK;

  if (looksLikeSilk) {
    try {
      const { decode } = await import('silk-wasm');
      const sampleRate = resolveSampleRate(voiceItem);
      const silk = normalizeSilkStream(input);
      const { data, duration } = await decode(silk, sampleRate);
      return {
        buffer: pcmS16ToWav(data, sampleRate),
        durationMs: duration,
        mimeType: 'audio/wav',
        name: 'voice.wav',
      };
    } catch (error) {
      onError?.(error);
    }
  }

  return { buffer: input, mimeType: 'audio/silk', name: 'voice.silk' };
}
