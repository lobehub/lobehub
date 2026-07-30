import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateWaveformLevel,
  createWaveformSamples,
  useVoiceMessageRecorder,
} from './useVoiceMessageRecorder';

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = vi.fn((mimeType: string) => mimeType === 'audio/webm;codecs=opus');

  mimeType: string;
  state: RecordingState = 'inactive';

  constructor(
    public stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    super();
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    const dataEvent = new Event('dataavailable') as Event & { data: Blob };
    dataEvent.data = new Blob(['recorded audio'], { type: this.mimeType });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event('stop'));
  }
}

describe('useVoiceMessageRecorder', () => {
  const trackStop = vi.fn();
  let now = 0;

  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: trackStop }],
        }),
      },
    });
    now = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a binary audio File with duration and codec metadata', async () => {
    const { result } = renderHook(() => useVoiceMessageRecorder({ now: () => now }));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('recording');

    now = 1_250;
    let recording: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      recording = await result.current.stop();
    });

    expect(recording?.file).toBeInstanceOf(File);
    expect(recording?.file.type).toBe('audio/webm;codecs=opus');
    expect(recording?.file.name).toMatch(/\.webm$/);
    expect(recording?.durationMs).toBe(1250);
    expect(recording?.codec).toBe('opus');
    expect(result.current.status).toBe('ready');
    expect(trackStop).toHaveBeenCalledOnce();
  });

  it('advances the visible waveform when the analyser receives audible samples', async () => {
    let animationFrame: FrameRequestCallback | undefined;
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const analyser = {
      fftSize: 2048,
      getByteTimeDomainData: vi.fn((samples: Uint8Array) => {
        samples.forEach((_, index) => {
          samples[index] = index % 2 === 0 ? 96 : 160;
        });
      }),
      smoothingTimeConstant: 0,
    };

    vi.stubGlobal(
      'AudioContext',
      class {
        close = vi.fn().mockResolvedValue(undefined);
        createAnalyser = vi.fn(() => analyser);
        createMediaStreamSource = vi.fn(() => source);
        state: AudioContextState = 'running';
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrame = callback;
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const { result } = renderHook(() => useVoiceMessageRecorder({ now: () => now }));

    await act(async () => {
      await result.current.start();
    });
    act(() => animationFrame?.(100));

    expect(analyser.fftSize).toBe(64);
    expect(result.current.waveform.at(-1)).toBeGreaterThan(0.5);
    expect(result.current.waveform.at(-2)).toBe(0.12);

    act(() => result.current.cancel());
  });

  it('returns to idle and discards captured data when cancelled', async () => {
    const { result } = renderHook(() => useVoiceMessageRecorder({ now: () => now }));

    await act(async () => {
      await result.current.start();
    });
    act(() => result.current.cancel());

    expect(result.current.status).toBe('idle');
    expect(result.current.recording).toBeUndefined();
    expect(trackStop).toHaveBeenCalledOnce();
  });

  it('surfaces a recoverable permission-denied state', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    );
    const { result } = renderHook(() => useVoiceMessageRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('permission_denied');
    expect(result.current.recording).toBeUndefined();
  });
});

describe('voice message waveform analysis', () => {
  it('configures the analyser before allocating an exact time-domain sample buffer', () => {
    const analyser = {
      fftSize: 2048,
      smoothingTimeConstant: 0,
    };

    const samples = createWaveformSamples(analyser);

    expect(analyser.fftSize).toBe(64);
    expect(analyser.smoothingTimeConstant).toBe(0.7);
    expect(samples).toHaveLength(64);
  });

  it('keeps silence low while mapping audible energy to a visibly taller level', () => {
    const silence = new Uint8Array(64).fill(128);
    const audible = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 96 : 160));

    expect(calculateWaveformLevel(silence)).toBe(0.08);
    expect(calculateWaveformLevel(audible)).toBeGreaterThan(0.5);
  });
});
