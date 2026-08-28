import { describe, expect, it } from 'vitest';

import { PcmFrameProcessor } from './audio';

describe('PcmFrameProcessor', () => {
  it('downmixes stereo, resamples 48 kHz to 16 kHz, and emits 6400-byte LE frames', () => {
    const processor = new PcmFrameProcessor(48_000);
    const left = new Float32Array(9600).fill(1);
    const right = new Float32Array(9600).fill(0);

    const frames = [...processor.process([left, right]), ...processor.flush()];

    expect(frames).toHaveLength(1);
    expect(frames[0].byteLength).toBe(6400);
    const view = new DataView(frames[0]);
    expect(view.getInt16(0, true)).toBe(16_384);
    expect(view.getInt16(2, true)).toBe(16_384);
  });

  it('aggregates chunks into one 200 ms frame', () => {
    const processor = new PcmFrameProcessor(16_000);

    expect(processor.process([new Float32Array(1000).fill(0.25)])).toEqual([]);
    expect(processor.process([new Float32Array(2200).fill(0.25)])).toEqual([]);

    const frames = processor.flush();
    expect(frames).toHaveLength(1);
    expect(frames[0].byteLength).toBe(6400);
  });

  it('pads the final short frame with silence and clamps PCM16 values', () => {
    const processor = new PcmFrameProcessor(16_000);
    processor.process([Float32Array.from([2, -2])]);

    const [frame] = processor.flush();
    const view = new DataView(frame);
    expect(view.getInt16(0, true)).toBe(32_767);
    expect(view.getInt16(2, true)).toBe(-32_768);
    expect(view.getInt16(4, true)).toBe(0);
    expect(frame.byteLength).toBe(6400);
  });
});
