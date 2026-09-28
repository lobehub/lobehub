import { encode } from 'silk-wasm';
import { describe, expect, it, vi } from 'vitest';

import {
  decodeWechatVoice,
  DEFAULT_WECHAT_VOICE_SAMPLE_RATE,
  isSilkStream,
  normalizeSilkStream,
  pcmS16ToWav,
} from './voice';

const SILK_MAGIC = Buffer.from('#!SILK_V3', 'ascii');

/**
 * 200ms 440Hz sine as mono pcm_s16le, then SILK-encoded by silk-wasm. The
 * encoder emits the Tencent form (`0x02` + `#!SILK_V3`), same as WeChat.
 */
async function makeSilk(sampleRate = DEFAULT_WECHAT_VOICE_SAMPLE_RATE): Promise<Buffer> {
  const samples = Math.round(sampleRate * 0.2);
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000);
  }
  const { data } = await encode(pcm.buffer, sampleRate);
  return Buffer.from(data);
}

const readWavHeader = (wav: Buffer) => ({
  audioFormat: wav.readUInt16LE(20),
  bitsPerSample: wav.readUInt16LE(34),
  channels: wav.readUInt16LE(22),
  data: wav.subarray(36, 40).toString('ascii'),
  dataSize: wav.readUInt32LE(40),
  riff: wav.subarray(0, 4).toString('ascii'),
  riffSize: wav.readUInt32LE(4),
  sampleRate: wav.readUInt32LE(24),
  wave: wav.subarray(8, 12).toString('ascii'),
});

describe('normalizeSilkStream / isSilkStream', () => {
  it('keeps a Tencent-prefixed SILK stream as is', () => {
    const prefixed = Buffer.concat([Buffer.from([0x02]), SILK_MAGIC, Buffer.from([1, 2, 3])]);
    expect(isSilkStream(prefixed)).toBe(true);
    expect(normalizeSilkStream(prefixed)).toBe(prefixed);
  });

  it('adds the 0x02 prefix to a bare SILK stream', () => {
    const bare = Buffer.concat([SILK_MAGIC, Buffer.from([1, 2, 3])]);
    expect(isSilkStream(bare)).toBe(true);
    const normalized = normalizeSilkStream(bare);
    expect(normalized[0]).toBe(0x02);
    expect(normalized.subarray(1).equals(bare)).toBe(true);
  });

  it('rejects non-SILK bytes', () => {
    expect(isSilkStream(Buffer.from('hello world'))).toBe(false);
    expect(isSilkStream(Buffer.from([0x02, 0x00, 0x01]))).toBe(false);
    expect(isSilkStream(Buffer.alloc(0))).toBe(false);
    const raw = Buffer.from('hello world');
    expect(normalizeSilkStream(raw)).toBe(raw);
  });
});

describe('pcmS16ToWav', () => {
  it('writes a valid mono 16-bit RIFF header', () => {
    const pcm = new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0]);
    const wav = pcmS16ToWav(pcm, 16_000);
    expect(wav.length).toBe(44 + pcm.length);
    expect(readWavHeader(wav)).toEqual({
      audioFormat: 1,
      bitsPerSample: 16,
      channels: 1,
      data: 'data',
      dataSize: 8,
      riff: 'RIFF',
      riffSize: 36 + 8,
      sampleRate: 16_000,
      wave: 'WAVE',
    });
    expect(wav.subarray(44).equals(Buffer.from(pcm))).toBe(true);
  });
});

describe('decodeWechatVoice', () => {
  it('decodes SILK to a playable WAV using the protocol default sample rate', async () => {
    const silk = await makeSilk();
    const result = await decodeWechatVoice(silk, { encode_type: 6 });

    expect(result.mimeType).toBe('audio/wav');
    expect(result.name).toBe('voice.wav');
    const header = readWavHeader(result.buffer);
    expect(header.riff).toBe('RIFF');
    expect(header.sampleRate).toBe(DEFAULT_WECHAT_VOICE_SAMPLE_RATE);
    // 200ms mono 16-bit @ 24kHz ≈ 9600 bytes; decoder pads to frame boundary.
    expect(header.dataSize).toBeGreaterThanOrEqual(9600);
    expect(result.durationMs).toBeGreaterThanOrEqual(200);
  });

  it('honours voice_item.sample_rate', async () => {
    const silk = await makeSilk(16_000);
    const result = await decodeWechatVoice(silk, { encode_type: 6, sample_rate: 16_000 });
    expect(readWavHeader(result.buffer).sampleRate).toBe(16_000);
  });

  it('decodes a bare #!SILK_V3 stream even without encode_type', async () => {
    const silk = await makeSilk();
    expect(silk[0]).toBe(0x02);
    const bare = silk.subarray(1);
    const result = await decodeWechatVoice(bare);
    expect(result.mimeType).toBe('audio/wav');
    expect(readWavHeader(result.buffer).dataSize).toBeGreaterThanOrEqual(9600);
  });

  it('passes MP3 through untouched', async () => {
    const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const result = await decodeWechatVoice(mp3, { encode_type: 7 });
    expect(result).toEqual({ buffer: mp3, mimeType: 'audio/mpeg', name: 'voice.mp3' });
  });

  it('falls back to raw audio/silk when the stream is not SILK', async () => {
    const onError = vi.fn();
    const raw = Buffer.from('not audio');
    const result = await decodeWechatVoice(raw, undefined, onError);
    expect(result).toEqual({ buffer: raw, mimeType: 'audio/silk', name: 'voice.silk' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('falls back and reports the error when SILK decoding fails', async () => {
    const onError = vi.fn();
    const corrupt = Buffer.concat([
      Buffer.from([0x02]),
      SILK_MAGIC,
      Buffer.from([0xff, 0xff, 0xff]),
    ]);
    const result = await decodeWechatVoice(corrupt, { encode_type: 6 }, onError);
    expect(result.mimeType).toBe('audio/silk');
    expect(result.name).toBe('voice.silk');
    expect(result.buffer).toBe(corrupt);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
