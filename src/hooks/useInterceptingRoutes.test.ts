import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIsMobile } from '@/hooks/useIsMobile';
import { openAgentSettingsModal } from '@/routes/(main)/agent/profile/features/AgentSettings';
import { useAgentStore } from '@/store/agent';
import { ChatSettingsTabs } from '@/store/global/initialState';

import { useOpenChatSettings } from './useInterceptingRoutes';

const mockNavigate = vi.fn();
const mockUseNavigate = vi.fn(() => mockNavigate);
const mockUseLocation = vi.fn(() => ({ pathname: '/' }));
vi.mock('react-router', () => ({
  useNavigate: () => mockUseNavigate(),
  useLocation: () => mockUseLocation(),
}));
vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: {
    setState: vi.fn(),
  },
}));
vi.mock('@/routes/(main)/agent/profile/features/AgentSettings', () => ({
  openAgentSettingsModal: vi.fn(),
}));
describe('useOpenChatSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({ activeAgentId: undefined });
  });

  it('navigates to mobile agent settings route for the active agent', () => {
    useAgentStore.setState({ activeAgentId: '123' });
    vi.mocked(useIsMobile).mockReturnValue(true);
    const { result } = renderHook(() => useOpenChatSettings(ChatSettingsTabs.Opening));

    act(() => {
      result.current();
    });

    expect(mockNavigate).toHaveBeenCalledWith(`/agent/123/settings?showMobileWorkspace=true`);
  });

  it('opens desktop agent settings overlay when not on mobile', () => {
    useAgentStore.setState({ activeAgentId: '456' });
    vi.mocked(useIsMobile).mockReturnValue(false);

    const { result } = renderHook(() => useOpenChatSettings(ChatSettingsTabs.Opening));

    act(() => {
      result.current();
    });

    expect(openAgentSettingsModal).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
