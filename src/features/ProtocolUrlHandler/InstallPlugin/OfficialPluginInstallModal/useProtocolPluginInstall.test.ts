import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useProtocolPluginInstall } from './useProtocolPluginInstall';

const setup = (installed = false) => {
  const options = {
    cancel: vi.fn(async () => {}),
    enable: vi.fn(async () => {}),
    install: vi.fn<() => Promise<boolean | undefined>>(async () => false),
    installed,
    onComplete: vi.fn(),
    onError: vi.fn(),
  };
  return {
    options,
    ...renderHook((props) => useProtocolPluginInstall(props), { initialProps: options }),
  };
};

describe('protocol marketplace installation', () => {
  it('keeps the request open at an authorization pause and completes only after the resumed installation is confirmed', async () => {
    const { options, result, rerender } = setup();
    await act(() => result.current.confirm());
    expect(result.current.loading).toBe(false);
    expect(options.enable).not.toHaveBeenCalled();
    expect(options.onComplete).not.toHaveBeenCalled();

    rerender({ ...options, installed: true });
    await waitFor(() => expect(options.onComplete).toHaveBeenCalledOnce());
    expect(options.enable).toHaveBeenCalledOnce();
    rerender({ ...options, installed: true });
    expect(options.onComplete).toHaveBeenCalledOnce();
  });

  it('also completes an immediate installation after its server-confirmed record arrives', async () => {
    const { options, result, rerender } = setup();
    options.install.mockResolvedValue(true);
    await act(() => result.current.confirm());
    expect(options.onComplete).not.toHaveBeenCalled();
    rerender({ ...options, installed: true });
    await waitFor(() => expect(options.onComplete).toHaveBeenCalledOnce());
  });

  it('does not auto-complete an already installed plugin when opening the modal', () => {
    const { options } = setup(true);
    expect(options.enable).not.toHaveBeenCalled();
    expect(options.onComplete).not.toHaveBeenCalled();
  });

  it('cancels a paused request on dismissal and ignores a later installation', async () => {
    const { options, result, rerender } = setup();
    await act(() => result.current.confirm());
    act(() => result.current.dismiss());
    expect(options.cancel).toHaveBeenCalledOnce();
    rerender({ ...options, installed: true });
    expect(options.enable).not.toHaveBeenCalled();
    expect(options.onComplete).not.toHaveBeenCalled();
  });

  it('cancels an unfinished request when its modal is unmounted', async () => {
    const { options, result, unmount } = setup();
    await act(() => result.current.confirm());
    unmount();
    expect(options.cancel).toHaveBeenCalledOnce();
  });

  it('allows retry after an installation error without showing success', async () => {
    const { options, result } = setup();
    options.install.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.confirm());
    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.onComplete).not.toHaveBeenCalled();
    await act(() => result.current.confirm());
    expect(options.install).toHaveBeenCalledTimes(2);
  });

  it('does not close the next request when enable finishes after this modal was unmounted', async () => {
    const { options, result, rerender, unmount } = setup();
    let resolveEnable!: () => void;
    options.enable.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveEnable = resolve;
        }),
    );
    await act(() => result.current.confirm());
    rerender({ ...options, installed: true });
    unmount();
    await act(async () => resolveEnable());
    expect(options.onComplete).not.toHaveBeenCalled();
  });
});
