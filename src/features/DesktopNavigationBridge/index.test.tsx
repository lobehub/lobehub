import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DesktopNavigationBridge from './index';

type NavigatePayload = { escape?: boolean; path: string; replace?: boolean };
type NavigateHandler = (payload: NavigatePayload) => void;

let registeredHandler: NavigateHandler | null = null;

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: NavigateHandler) => {
    if (event === 'navigate') registeredHandler = handler;
  },
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

const emitNavigate = (payload: NavigatePayload) => {
  act(() => {
    registeredHandler?.(payload);
  });
};

describe('DesktopNavigationBridge', () => {
  beforeEach(() => {
    registeredHandler = null;
    navigateMock.mockReset();
  });

  it('uses escaped navigation for literal desktop notification paths', () => {
    render(<DesktopNavigationBridge />);

    emitNavigate({ escape: true, path: '/team/agent/a1/t1' });

    expect(navigateMock).toHaveBeenCalledWith('/team/agent/a1/t1', {
      escape: true,
      replace: false,
    });
  });

  it('preserves replace navigation options from desktop broadcasts', () => {
    render(<DesktopNavigationBridge />);

    emitNavigate({ path: '/agent/a1', replace: true });

    expect(navigateMock).toHaveBeenCalledWith('/agent/a1', {
      escape: false,
      replace: true,
    });
  });

  it('keeps legacy broadcasts as plain workspace-aware navigation', () => {
    render(<DesktopNavigationBridge />);

    emitNavigate({ path: '/agent/a1/t1' });

    expect(navigateMock).toHaveBeenCalledWith('/agent/a1/t1');
  });

  it('ignores empty navigation paths', () => {
    render(<DesktopNavigationBridge />);

    emitNavigate({ path: '' });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
