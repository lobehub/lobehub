import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateWaveformLevel,
  createWaveformSamples,
  useVoiceMessageRecorder,
} from './useVoiceMessageRecorder';

class FakeMediaRecorder extends EventTarget {
  static deferStopEvent = false;
  static isTypeSupported = vi.fn((mimeType: string) => mimeType === 'audio/webm;codecs=opus');
  static latest: FakeMediaRecorder | undefined;

  mimeType: string;
  state: RecordingState = 'inactive';

  constructor(
    public stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    super();
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.latest = this;
  }

  fail(error: unknown = new DOMException('encoder failed', 'UnknownError')) {
    this.state = 'inactive';
    const errorEvent = new Event('error') as Event & { error: unknown };
    errorEvent.error = error;
    this.dispatchEvent(errorEvent);

    const dataEvent = new Event('dataavailable') as Event & { data: Blob };
    dataEvent.data = new Blob(['partial audio'], { type: this.mimeType });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event('stop'));
  }

  start() {
    this.state = 'recording';
  }

  completeStop() {
    const dataEvent = new Event('dataavailable') as Event & { data: Blob };
    dataEvent.data = new Blob(['recorded audio'], { type: this.mimeType });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event('stop'));
  }

  stop() {
    this.state = 'inactive';
    if (!FakeMediaRecorder.deferStopEvent) this.completeStop();
  }
}

describe('useVoiceMessageRecorder', () => {
  const trackStop = vi.fn();
  let now = 0;

  beforeEach(() => {
    FakeMediaRecorder.deferStopEvent = false;
    FakeMediaRecorder.latest = undefined;
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
    const normalizeRecording = vi.fn().mockResolvedValue({
      blob: new Blob(['wav audio'], { type: 'audio/wav' }),
      codec: 'pcm_s16le',
      mimeType: 'audio/wav',
    });
    const { result } = renderHook(() =>
      useVoiceMessageRecorder({ normalizeRecording, now: () => now }),
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('recording');

    now = 1_250;
    let recording: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      recording = await result.current.stop();
    });

    expect(normalizeRecording).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audio/webm;codecs=opus' }),
    );
    expect(recording?.file).toBeInstanceOf(File);
    expect(recording?.file.type).toBe('audio/wav');
    expect(recording?.file.name).toMatch(/\.wav$/);
    expect(recording?.durationMs).toBe(1250);
    expect(recording?.codec).toBe('pcm_s16le');
    expect(result.current.status).toBe('ready');
    expect(trackStop).toHaveBeenCalledOnce();
  });

  it('surfaces a recoverable error when the recorded container cannot be normalized', async () => {
    const normalizeRecording = vi.fn().mockRejectedValue(new Error('decode failed'));
    const { result } = renderHook(() =>
      useVoiceMessageRecorder({ normalizeRecording, now: () => now }),
    );

    await act(async () => {
      await result.current.start();
    });
    now = 1_250;
    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('recording_failed');
    expect(result.current.recording).toBeUndefined();
  });

  it('keeps a new recording intact when a cancelled normalization finishes late', async () => {
    let finishNormalization:
      ((value: { blob: Blob; codec: string; mimeType: string }) => void) | undefined;
    const normalizedRecording = {
      blob: new Blob(['wav audio'], { type: 'audio/wav' }),
      codec: 'pcm_s16le',
      mimeType: 'audio/wav',
    };
    const normalizeRecording = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ blob: Blob; codec: string; mimeType: string }>((resolve) => {
            finishNormalization = resolve;
          }),
      )
      .mockResolvedValue(normalizedRecording);
    const { result } = renderHook(() =>
      useVoiceMessageRecorder({ normalizeRecording, now: () => now }),
    );

    await act(async () => {
      await result.current.start();
    });
    now = 1_250;
    act(() => {
      void result.current.stop();
    });
    act(() => result.current.cancel());
    await act(async () => {
      await result.current.start();
    });
    finishNormalization?.(normalizedRecording);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('recording');
    now = 2_500;
    let secondRecording: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      secondRecording = await result.current.stop();
    });

    expect(secondRecording?.file.type).toBe('audio/wav');
    expect(result.current.status).toBe('ready');
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

  it('ignores a cancelled recorder stop event after a new recording starts', async () => {
    const normalizedRecording = {
      blob: new Blob(['wav audio'], { type: 'audio/wav' }),
      codec: 'pcm_s16le',
      mimeType: 'audio/wav',
    };
    const { result } = renderHook(() =>
      useVoiceMessageRecorder({
        normalizeRecording: vi.fn().mockResolvedValue(normalizedRecording),
        now: () => now,
      }),
    );

    FakeMediaRecorder.deferStopEvent = true;
    await act(async () => {
      await result.current.start();
    });
    const cancelledRecorder = FakeMediaRecorder.latest;
    act(() => result.current.cancel());

    FakeMediaRecorder.deferStopEvent = false;
    await act(async () => {
      await result.current.start();
    });
    act(() => cancelledRecorder?.completeStop());

    expect(result.current.status).toBe('recording');
    now = 1_250;
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe('ready');
  });

  it('does not tear down a new recording when an older permission request rejects late', async () => {
    let rejectFirstRequest: ((reason?: unknown) => void) | undefined;
    const firstRequest = new Promise<MediaStream>((_, reject) => {
      rejectFirstRequest = reject;
    });
    const secondTrackStop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia)
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({
        getTracks: () => [{ stop: secondTrackStop }],
      } as unknown as MediaStream);
    const normalizedRecording = {
      blob: new Blob(['wav audio'], { type: 'audio/wav' }),
      codec: 'pcm_s16le',
      mimeType: 'audio/wav',
    };
    const { result } = renderHook(() =>
      useVoiceMessageRecorder({
        normalizeRecording: vi.fn().mockResolvedValue(normalizedRecording),
        now: () => now,
      }),
    );

    let firstStart: Promise<void>;
    act(() => {
      firstStart = result.current.start();
    });
    act(() => result.current.cancel());
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      rejectFirstRequest?.(new DOMException('late denial', 'NotAllowedError'));
      await firstStart;
    });

    expect(result.current.status).toBe('recording');
    expect(secondTrackStop).not.toHaveBeenCalled();

    now = 1_250;
    let recording: Awaited<ReturnType<typeof result.current.stop>>;
    await act(async () => {
      recording = await result.current.stop();
    });

    expect(recording?.file.type).toBe('audio/wav');
    expect(secondTrackStop).toHaveBeenCalledOnce();
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

  it('keeps an encoder error after the final data and stop events', async () => {
    const { result } = renderHook(() => useVoiceMessageRecorder({ now: () => now }));

    await act(async () => {
      await result.current.start();
    });
    act(() => FakeMediaRecorder.latest?.fail());

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('recording_failed');
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
