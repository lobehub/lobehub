import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalVideo } from './useLocalVideo';

const { readLocalVideo } = vi.hoisted(() => ({ readLocalVideo: vi.fn() }));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { readLocalVideo },
}));

const params = { filePath: '/repo/demo.mp4', revision: '3:1', workingDirectory: '/repo' };

describe('useLocalVideo', () => {
  let urlCount = 0;
  const createObjectURL = vi.fn(() => `blob:video-${++urlCount}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    urlCount = 0;
    readLocalVideo.mockReset();
    readLocalVideo.mockResolvedValue({ blob: new Blob(), ok: true });
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('releases the blob when the video turns out to be undecodable', async () => {
    const { result } = renderHook(() => useLocalVideo(params));
    await waitFor(() =>
      expect(result.current.state).toEqual({ src: 'blob:video-1', status: 'ready' }),
    );

    act(() => result.current.markUnplayable());

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-1');
    expect(result.current.state).toEqual({ oversized: false, status: 'unplayable' });
  });

  it('re-reads the file when the preview revision changes', async () => {
    const { result, rerender } = renderHook((props) => useLocalVideo(props), {
      initialProps: params,
    });
    await waitFor(() =>
      expect(result.current.state).toEqual({ src: 'blob:video-1', status: 'ready' }),
    );

    rerender({ ...params, revision: '4:2' });

    await waitFor(() =>
      expect(result.current.state).toEqual({ src: 'blob:video-2', status: 'ready' }),
    );
    expect(readLocalVideo).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-1');
  });

  it('aborts an in-flight read on unmount', () => {
    readLocalVideo.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useLocalVideo(params));
    const signal = readLocalVideo.mock.calls[0][1] as AbortSignal;

    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('reports an oversized video as unplayable', async () => {
    readLocalVideo.mockResolvedValue({ ok: false, reason: 'oversized' });
    const { result } = renderHook(() => useLocalVideo(params));

    await waitFor(() =>
      expect(result.current.state).toEqual({ oversized: true, status: 'unplayable' }),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
