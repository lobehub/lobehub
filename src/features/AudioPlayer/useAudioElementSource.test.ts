import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAudioElementSource } from './useAudioElementSource';

describe('useAudioElementSource', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores the next source after cleaning up the previous URL', () => {
    const audio = document.createElement('audio');
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(audio, 'load').mockImplementation(() => {});
    const audioRef = { current: audio };
    const firstUrl = 'https://example.com/first.webm';
    const secondUrl = 'https://example.com/second.webm';

    const { rerender, unmount } = renderHook(({ url }) => useAudioElementSource(audioRef, url), {
      initialProps: { url: firstUrl },
    });

    expect(audio.src).toBe(firstUrl);

    rerender({ url: secondUrl });

    expect(pause).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(audio.src).toBe(secondUrl);

    unmount();

    expect(pause).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(audio.hasAttribute('src')).toBe(false);
  });
});
