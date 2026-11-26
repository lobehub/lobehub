import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { useOpenChatSettings } from './useInterceptingRoutes';

const mockNavigate = vi.fn();
vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => mockNavigate,
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: {
    setState: vi.fn(),
  },
}));

describe('useOpenChatSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({ activeAgentId: undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigates to the mobile settings screen in the mobile bundle', () => {
    vi.stubGlobal('__MOBILE__', true);
    useAgentStore.setState({ activeAgentId: '123' });
    const { result } = renderHook(() => useOpenChatSettings());

    act(() => {
      result.current();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/agent/123/settings?showMobileWorkspace=true');
  });

  it('navigates to the opening settings page on desktop and web', () => {
    vi.stubGlobal('__MOBILE__', false);
    useAgentStore.setState({ activeAgentId: '456' });
    const { result } = renderHook(() => useOpenChatSettings());

    act(() => {
      result.current();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/agent/456/opening');
  });

  it('does nothing without an active agent', () => {
    const { result } = renderHook(() => useOpenChatSettings());

    act(() => {
      result.current();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
