import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVoiceMessageRecorder } from './useVoiceMessageRecorder';

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
