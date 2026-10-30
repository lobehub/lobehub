import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('BrowserAudioWorkletCapture', () => {
  const contexts: FakeAudioContext[] = [];
  let failNextModule = false;

  class FakeAudioContext {
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    close = vi.fn(async () => {
      this.state = 'closed';
    });
    destination = {};
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    state: AudioContextState = 'suspended';
    suspend = vi.fn(async () => {
      this.state = 'suspended';
    });

    constructor() {
      contexts.push(this);
      if (failNextModule) {
        failNextModule = false;
        this.audioWorklet.addModule.mockRejectedValueOnce(new Error('worklet_failed'));
      }
    }

    createGain() {
      return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
    }

    createMediaStreamSource() {
      return { connect: vi.fn(), disconnect: vi.fn() };
    }
  }

  class FakeWorkletNode {
    addEventListener = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    port = { onmessage: null, postMessage: vi.fn() };
  }

  const stream = () => {
    const track = { stop: vi.fn() };
    return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
  };

  const loadCapture = async () => {
    vi.resetModules();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:worklet');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { BrowserAudioWorkletCapture } = await import('./audio');
    return BrowserAudioWorkletCapture;
  };

  afterEach(() => {
    contexts.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reuses one context and worklet module across sessions and suspends between them', async () => {
    const Capture = await loadCapture();
    const first = stream();

    const capture = await Capture.create(first.stream);
    await capture.start(vi.fn(), vi.fn());
    await capture.cancel();
    const second = await Capture.create(stream().stream);
    await second.start(vi.fn(), vi.fn());

    expect(contexts).toHaveLength(1);
    expect(contexts[0].audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(contexts[0].close).not.toHaveBeenCalled();
    expect(contexts[0].suspend).toHaveBeenCalledOnce();
    expect(contexts[0].resume).toHaveBeenCalledTimes(2);
    expect(first.track.stop).toHaveBeenCalledOnce();
  });

  it('creates a new context after the shared one was closed', async () => {
    const Capture = await loadCapture();

    await Capture.create(stream().stream);
    contexts[0].state = 'closed';
    await Capture.create(stream().stream);

    expect(contexts).toHaveLength(2);
  });

  it('retries the worklet module after a failed load and releases the microphone', async () => {
    const Capture = await loadCapture();
    const failed = stream();
    failNextModule = true;

    await expect(Capture.create(failed.stream)).rejects.toThrow('worklet_failed');
    expect(failed.track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();

    await Capture.create(stream().stream);
    expect(contexts).toHaveLength(2);
  });
});
