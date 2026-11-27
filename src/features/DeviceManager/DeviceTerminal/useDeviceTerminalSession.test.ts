import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDeviceTerminalSession } from './useDeviceTerminalSession';

const mocks = vi.hoisted(() => {
  const exitListeners = new Set<(sessionId: string, exitCode: number) => void>();
  return {
    close: vi.fn(),
    dispose: vi.fn(async () => {}),
    disposeOnUnload: vi.fn(),
    exitListeners,
    open: vi.fn(),
  };
});

vi.mock('@/features/ChatTerminal/deviceTerminal', () => ({
  DeviceTerminalSession: { open: mocks.open },
}));

vi.mock('@/features/ChatTerminal/xtermManager', () => ({
  xtermManager: {
    close: mocks.close,
    onSessionExit: (listener: (sessionId: string, exitCode: number) => void) => {
      mocks.exitListeners.add(listener);
      return () => mocks.exitListeners.delete(listener);
    },
  },
}));

const fakeSession = (sessionId = 'term_1') => ({
  dispose: mocks.dispose,
  disposeOnUnload: mocks.disposeOnUnload,
  sessionId,
});

const params = { deviceId: 'dev-1', enabled: true, scope: 'personal' as const };

describe('useDeviceTerminalSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exitListeners.clear();
    mocks.open.mockResolvedValue(fakeSession());
  });

  it('opens one shell on the device in its own scope', async () => {
    const { result } = renderHook(() => useDeviceTerminalSession({ ...params, cwd: '/srv' }));

    await waitFor(() =>
      expect(result.current.state).toEqual({ sessionId: 'term_1', status: 'open' }),
    );
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(
      'dev-1',
      { cols: 80, cwd: '/srv', rows: 24 },
      { scope: 'personal' },
    );
  });

  it('does not open a shell until the device can host one', () => {
    const { result } = renderHook(() => useDeviceTerminalSession({ ...params, enabled: false }));

    expect(result.current.state).toEqual({ status: 'idle' });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('ends the shell on the device when the panel goes away', async () => {
    const { result, unmount } = renderHook(() => useDeviceTerminalSession(params));
    await waitFor(() => expect(result.current.state.status).toBe('open'));

    unmount();

    expect(mocks.close).toHaveBeenCalledWith('term_1');
  });

  it('closes a shell that finishes opening after the panel went away', async () => {
    let resolveOpen!: (session: ReturnType<typeof fakeSession>) => void;
    mocks.open.mockReturnValueOnce(new Promise((resolve) => (resolveOpen = resolve)));
    const { unmount } = renderHook(() => useDeviceTerminalSession(params));

    unmount();
    expect(mocks.close).not.toHaveBeenCalled();
    await act(async () => resolveOpen(fakeSession('term_late')));

    expect(mocks.close).toHaveBeenCalledWith('term_late');
  });

  it('ends the shell with a keepalive close when the browser tab closes', async () => {
    const { result } = renderHook(() => useDeviceTerminalSession(params));
    await waitFor(() => expect(result.current.state.status).toBe('open'));

    window.dispatchEvent(new Event('pagehide'));

    expect(mocks.disposeOnUnload).toHaveBeenCalledTimes(1);
  });

  it('ends a shell that finishes opening after the page was hidden', async () => {
    let resolveOpen!: (session: ReturnType<typeof fakeSession>) => void;
    mocks.open.mockReturnValueOnce(new Promise((resolve) => (resolveOpen = resolve)));
    renderHook(() => useDeviceTerminalSession(params));

    window.dispatchEvent(new Event('pagehide'));
    await act(async () => resolveOpen(fakeSession('term_late')));

    expect(mocks.disposeOnUnload).toHaveBeenCalledTimes(1);
  });

  it('replaces the shell when the start directory changes', async () => {
    mocks.open.mockResolvedValueOnce(fakeSession('term_1'));
    mocks.open.mockResolvedValueOnce(fakeSession('term_2'));
    const { result, rerender } = renderHook((cwd?: string) =>
      useDeviceTerminalSession({ ...params, cwd }),
    );
    await waitFor(() => expect(result.current.state).toMatchObject({ sessionId: 'term_1' }));

    rerender('/srv');

    expect(mocks.close).toHaveBeenCalledWith('term_1');
    await waitFor(() => expect(result.current.state).toMatchObject({ sessionId: 'term_2' }));
  });

  it('shows the exit and does not route the close through this machine', async () => {
    const { result, unmount } = renderHook(() => useDeviceTerminalSession(params));
    await waitFor(() => expect(result.current.state.status).toBe('open'));

    act(() => {
      for (const listener of mocks.exitListeners) listener('term_1', 0);
    });
    expect(result.current.state).toEqual({ status: 'exited' });

    unmount();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it('reports a client that cannot host a terminal', async () => {
    mocks.open.mockRejectedValueOnce(new Error('This device client does not support a terminal'));
    const { result } = renderHook(() => useDeviceTerminalSession(params));

    await waitFor(() =>
      expect(result.current.state).toEqual({ error: 'unsupported', status: 'error' }),
    );
  });

  it('opens a fresh shell on reopen', async () => {
    mocks.open.mockResolvedValueOnce(fakeSession('term_1'));
    mocks.open.mockResolvedValueOnce(fakeSession('term_2'));
    const { result } = renderHook(() => useDeviceTerminalSession(params));
    await waitFor(() => expect(result.current.state).toMatchObject({ sessionId: 'term_1' }));

    act(() => result.current.reopen());

    expect(mocks.close).toHaveBeenCalledWith('term_1');
    await waitFor(() => expect(result.current.state).toMatchObject({ sessionId: 'term_2' }));
  });
});
