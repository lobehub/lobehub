/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioDuration } from './audioDuration';

const listeners = new Map<string, EventListener>();

let audio: {
  addEventListener: ReturnType<typeof vi.fn>;
  duration: number;
  load: ReturnType<typeof vi.fn>;
  preload: string;
  removeAttribute: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  src: string;
};

beforeEach(() => {
  vi.useFakeTimers();
  listeners.clear();

  audio = {
    addEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.set(event, listener);
    }),
    duration: 0,
    load: vi.fn(),
    preload: '',
    removeAttribute: vi.fn(),
    removeEventListener: vi.fn(),
    src: '',
  };

  vi.stubGlobal(
    'Audio',
    vi.fn(() => audio),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getAudioDuration', () => {
  it('returns a rounded-up duration from local media metadata and cleans up the object URL', async () => {
    const file = new File(['audio'], 'voice.webm', { type: 'audio/webm' });
    const durationPromise = getAudioDuration(file);

    audio.duration = 2.5001;
    listeners.get('loadedmetadata')?.(new Event('loadedmetadata'));

    await expect(durationPromise).resolves.toBe(2501);
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio');
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('waits for a finite duration when the first metadata value is infinite', async () => {
    const durationPromise = getAudioDuration(
      new File(['audio'], 'voice.webm', { type: 'audio/webm' }),
    );

    audio.duration = Number.POSITIVE_INFINITY;
    listeners.get('loadedmetadata')?.(new Event('loadedmetadata'));
    audio.duration = 4;
    listeners.get('durationchange')?.(new Event('durationchange'));

    await expect(durationPromise).resolves.toBe(4000);
  });

  it('returns undefined when the browser rejects the media', async () => {
    const durationPromise = getAudioDuration(
      new File(['invalid'], 'voice.webm', { type: 'audio/webm' }),
    );

    listeners.get('error')?.(new Event('error'));

    await expect(durationPromise).resolves.toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio');
  });

  it('still resolves when object URL cleanup throws', async () => {
    vi.mocked(URL.revokeObjectURL).mockImplementation(() => {
      throw new Error('revoke unavailable');
    });
    const durationPromise = getAudioDuration(
      new File(['audio'], 'voice.webm', { type: 'audio/webm' }),
    );

    audio.duration = 3;
    listeners.get('loadedmetadata')?.(new Event('loadedmetadata'));

    await expect(durationPromise).resolves.toBe(3000);
  });

  it('returns undefined after the metadata timeout', async () => {
    const durationPromise = getAudioDuration(
      new File(['audio'], 'voice.webm', { type: 'audio/webm' }),
    );

    await vi.advanceTimersByTimeAsync(5000);

    await expect(durationPromise).resolves.toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio');
  });
});
