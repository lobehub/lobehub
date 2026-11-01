import { describe, expect, it, vi } from 'vitest';

import { normalizeVoiceRecording } from './normalizeRecording';

const readAscii = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('');

describe('normalizeVoiceRecording', () => {
  it('converts browser-recorded audio into mono 16 kHz PCM WAV', async () => {
    const source = new Blob(['webm audio'], { type: 'audio/webm;codecs=opus' });
    const decode = vi.fn().mockResolvedValue({
      getChannelData: (channel: number) =>
        channel === 0
          ? Float32Array.from([1, 1, 1, -1, -1, -1])
          : Float32Array.from([0, 0, 0, 0, 0, 0]),
      length: 6,
      numberOfChannels: 2,
      sampleRate: 48_000,
    });

    const result = await normalizeVoiceRecording(source, decode);
    const view = new DataView(await result.blob.arrayBuffer());

    expect(decode).toHaveBeenCalledWith(source);
    expect(result.mimeType).toBe('audio/wav');
    expect(result.codec).toBe('pcm_s16le');
    expect(result.blob.type).toBe('audio/wav');
    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(16_383);
    expect(view.getInt16(46, true)).toBe(-16_384);
  });

  it('rejects decoded audio without usable samples', async () => {
    const decode = vi.fn().mockResolvedValue({
      getChannelData: () => new Float32Array(),
      length: 0,
      numberOfChannels: 0,
      sampleRate: 0,
    });

    await expect(normalizeVoiceRecording(new Blob(['invalid']), decode)).rejects.toThrow(
      'could not be decoded',
    );
  });
});
