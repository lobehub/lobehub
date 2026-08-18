import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';

import { useEffectiveWorkingDirectory } from './useEffectiveWorkingDirectory';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDesktop: true,
}));

vi.mock('@/helpers/GlobalAgentContextManager', () => ({
  globalAgentContextManager: {
    getContext: () => ({ desktopPath: '/Users/me/Desktop', homePath: '/Users/me' }),
  },
}));

const effectiveAgencyConfig = vi.hoisted(() => ({
  agencyConfig: undefined as unknown,
  workspaceScoped: false,
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => effectiveAgencyConfig,
}));

vi.mock('@/store/agent', () => ({ useAgentStore: vi.fn() }));
vi.mock('@/store/chat', () => ({ useChatStore: vi.fn() }));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentTopicMetadata: (s: { topicMetadata?: object }) => s.topicMetadata,
    currentTopicWorkingDirectory: (s: { topicWorkingDirectory?: string }) =>
      s.topicWorkingDirectory,
    getTopicById: () => (s: { topicMetadata?: object }) => ({ metadata: s.topicMetadata }),
    getTopicWorkingDirectory: (id?: string | null) => (s: { topicWorkingDirectory?: string }) =>
      id === null ? undefined : s.topicWorkingDirectory,
  },
}));
vi.mock('@/store/device', () => ({
  deviceSelectors: {
    getDeviceDefaultCwd: () => (s: { deviceDefaultCwd?: string }) => s.deviceDefaultCwd,
  },
  useDeviceStore: vi.fn(),
}));
vi.mock('@/store/electron', () => ({ useElectronStore: vi.fn() }));
vi.mock('@/store/user', () => ({ useUserStore: vi.fn() }));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: () => true },
}));

const mockedUseAgentStore = vi.mocked(useAgentStore);
const mockedUseChatStore = vi.mocked(useChatStore);
const mockedUseDeviceStore = vi.mocked(useDeviceStore);
const mockedUseElectronStore = vi.mocked(useElectronStore);
const mockedUseUserStore = vi.mocked(useUserStore);

const setupStores = ({
  agencyConfig,
  deviceDefaultCwd,
  legacyWorkingDirectory,
  topicWorkingDirectory,
}: {
  agencyConfig?: unknown;
  deviceDefaultCwd?: string;
  legacyWorkingDirectory?: string;
  topicWorkingDirectory?: string;
} = {}) => {
  effectiveAgencyConfig.agencyConfig = agencyConfig;

  const agentState = {
    localAgentWorkingDirectoryMap: legacyWorkingDirectory
      ? { 'agent-1': legacyWorkingDirectory }
      : {},
  };
  const chatState = { topicMetadata: undefined, topicWorkingDirectory };
  const deviceState = { deviceDefaultCwd, useFetchDevices: vi.fn() };
  const electronState = { gatewayDeviceInfo: { deviceId: 'device-A' } };
  const userState = {};

  mockedUseAgentStore.mockImplementation((selector: any) => selector(agentState));
  mockedUseChatStore.mockImplementation((selector: any) => selector(chatState));
  mockedUseDeviceStore.mockImplementation((selector: any) => selector(deviceState));
  mockedUseElectronStore.mockImplementation((selector: any) => selector(electronState));
  mockedUseUserStore.mockImplementation((selector: any) => selector(userState));
};

describe('useEffectiveWorkingDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    effectiveAgencyConfig.agencyConfig = undefined;
    effectiveAgencyConfig.workspaceScoped = false;
  });

  it('falls back to the desktop path when nothing is configured', () => {
    setupStores();

    const { result } = renderHook(() => useEffectiveWorkingDirectory('agent-1'));

    expect(result.current).toBe('/Users/me/Desktop');
  });

  it('returns undefined with homeFallback disabled and nothing configured', () => {
    // Regression: the conversation header must not surface the open-in-IDE
    // button off the desktop/home fallback when no directory was ever picked.
    setupStores();

    const { result } = renderHook(() =>
      useEffectiveWorkingDirectory('agent-1', { homeFallback: false }),
    );

    expect(result.current).toBeUndefined();
  });

  it('still resolves explicitly configured directories with homeFallback disabled', () => {
    setupStores({
      agencyConfig: { workingDirByDevice: { 'device-A': '/repo/project' } },
    });

    const { result } = renderHook(() =>
      useEffectiveWorkingDirectory('agent-1', { homeFallback: false }),
    );

    expect(result.current).toBe('/repo/project');
  });

  it('prefers the topic override over the agent choice', () => {
    setupStores({
      agencyConfig: { workingDirByDevice: { 'device-A': '/repo/project' } },
      topicWorkingDirectory: '/repo/topic-project',
    });

    const { result } = renderHook(() =>
      useEffectiveWorkingDirectory('agent-1', { homeFallback: false }),
    );

    expect(result.current).toBe('/repo/topic-project');
  });

  it('resolves a route-scoped topic override', () => {
    setupStores({
      agencyConfig: { workingDirByDevice: { 'device-A': '/repo/project' } },
      topicWorkingDirectory: '/repo/split-pane-topic',
    });

    const { result } = renderHook(() =>
      useEffectiveWorkingDirectory('agent-1', {
        homeFallback: false,
        topicId: 'topic-in-split-pane',
      }),
    );

    expect(result.current).toBe('/repo/split-pane-topic');
  });

  it('does not inherit the active topic directory for a new-topic pane', () => {
    setupStores({
      agencyConfig: { workingDirByDevice: { 'device-A': '/repo/agent-default' } },
      topicWorkingDirectory: '/repo/other-pane-topic',
    });

    const { result } = renderHook(() =>
      useEffectiveWorkingDirectory('agent-1', {
        homeFallback: false,
        topicId: null,
      }),
    );

    expect(result.current).toBe('/repo/agent-default');
  });

  it('keeps the device default cwd with homeFallback disabled', () => {
    setupStores({ deviceDefaultCwd: '/repo/device-default' });

    const { result } = renderHook(() =>
      useEffectiveWorkingDirectory('agent-1', { homeFallback: false }),
    );

    expect(result.current).toBe('/repo/device-default');
  });
});
