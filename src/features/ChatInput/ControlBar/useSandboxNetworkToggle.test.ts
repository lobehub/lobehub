import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';

import { useSandboxNetworkToggle } from './useSandboxNetworkToggle';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDesktop: true,
}));

vi.mock('@/features/ResourcePermission/useAgentManagementAccess', () => ({
  useAgentManagementAccess: () => ({ canManageAgent: true, isAccessLoading: false }),
}));

const topicState = vi.hoisted(() => ({
  activeTopicId: 'topic-1' as string | undefined,
  gatewayDeviceInfo: { deviceId: 'device-a' },
  topics: {} as Record<string, { agentId: string; metadata?: { boundDeviceId?: string } }>,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: typeof topicState) => unknown) => selector(topicState),
}));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (s: typeof topicState) => s.topics[id],
  },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: typeof topicState) => unknown) => selector(topicState),
}));

vi.mock('@/store/agent', () => ({ useAgentStore: vi.fn() }));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById:
      (id: string) => (s: { agentMap: Record<string, { agencyConfig?: unknown }> }) =>
        s.agentMap[id]?.agencyConfig,
    getAgentById: (id: string) => (s: { agentMap: Record<string, unknown> }) => s.agentMap[id],
  },
}));
vi.mock('@/store/user', () => ({ useUserStore: vi.fn() }));

const selectExecutionTarget = vi.fn();

const setupStores = (agencyConfig: unknown) => {
  const agentState = { agentMap: { 'agent-1': { agencyConfig } } };
  const userState = {
    useFetchWorkspaceUserPreference: () => ({ data: {}, isLoading: false }),
    workspaceUserPreference: {},
  };
  vi.mocked(useAgentStore).mockImplementation((selector: any) => selector(agentState));
  vi.mocked(useUserStore).mockImplementation((selector: any) => selector(userState));
};

const renderToggle = () =>
  renderHook(() =>
    useSandboxNetworkToggle({
      agentId: 'agent-1',
      isHetero: true,
      selectExecutionTarget,
    }),
  );

beforeEach(() => {
  selectExecutionTarget.mockReset().mockResolvedValue(true);
  topicState.activeTopicId = 'topic-1';
  topicState.topics = {};
});

describe('useSandboxNetworkToggle', () => {
  const localSandboxDefault = {
    boundDeviceId: 'device-a',
    executionTarget: 'local',
    localSandbox: true,
  };

  // The composer shows the topic's machine, but the save must not move the default there.
  it('keeps the agent default when the open topic is pinned to another machine', async () => {
    topicState.topics = {
      'topic-1': { agentId: 'agent-1', metadata: { boundDeviceId: 'device-b' } },
    };
    setupStores(localSandboxDefault);
    const { result } = renderToggle();

    await act(() => result.current(true));

    expect(selectExecutionTarget).toHaveBeenCalledWith('local', 'device-a', {
      localSandbox: true,
      localSandboxNetwork: true,
    });
  });

  it('does not turn the default sandbox flag on from a topic pinned to this machine', async () => {
    topicState.topics = {
      'topic-1': { agentId: 'agent-1', metadata: { boundDeviceId: 'device-a' } },
    };
    setupStores({ boundDeviceId: 'device-b', executionTarget: 'device', localSandbox: true });
    const { result } = renderToggle();

    await act(() => result.current(false));

    expect(selectExecutionTarget).toHaveBeenCalledWith('device', 'device-b', {
      localSandbox: false,
      localSandboxNetwork: false,
    });
  });

  it('saves the current target unchanged when the topic has no machine binding', async () => {
    topicState.topics = { 'topic-1': { agentId: 'agent-1' } };
    setupStores(localSandboxDefault);
    const { result } = renderToggle();

    await act(() => result.current(false));

    expect(selectExecutionTarget).toHaveBeenCalledWith('local', 'device-a', {
      localSandbox: true,
      localSandboxNetwork: false,
    });
  });
});
