import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveEffectiveWorkingDirectory } from '../effectiveWorkingDirectory';

vi.mock('@lobechat/const', () => ({
  isDesktop: true,
}));

const mockGetElectronStoreState = vi.fn();
vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => mockGetElectronStoreState(),
}));

const mockGetAgentStoreState = vi.fn();
vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => mockGetAgentStoreState(),
}));

const mockCurrentAgentWorkingDirectory = vi.fn();
const mockGetAgentWorkingDirectoryById = vi.fn();
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentWorkingDirectory: (deviceId?: string) => mockCurrentAgentWorkingDirectory(deviceId),
  },
  agentByIdSelectors: {
    getAgentWorkingDirectoryById: (agentId: string, deviceId?: string) => () =>
      mockGetAgentWorkingDirectoryById(agentId, deviceId),
  },
}));

const mockGetTopicWorkingDirectory = vi.fn();
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicWorkingDirectory: (topicId?: string | null) => (state: any) =>
      mockGetTopicWorkingDirectory(topicId, state),
  },
}));

describe('resolveEffectiveWorkingDirectory', () => {
  const chatState = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetElectronStoreState.mockReturnValue({
      gatewayDeviceInfo: { deviceId: 'device-1' },
    });
    mockGetAgentStoreState.mockReturnValue({});
  });

  it('returns the topic working directory when one is configured', () => {
    mockGetTopicWorkingDirectory.mockReturnValue('/home/user/project');

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1');

    expect(result).toBe('/home/user/project');
    expect(mockGetTopicWorkingDirectory).toHaveBeenCalledWith('topic-1', chatState);
  });

  it('falls back to the active agent when no topic working directory and no agentId', () => {
    mockGetTopicWorkingDirectory.mockReturnValue(undefined);
    mockCurrentAgentWorkingDirectory.mockReturnValue(() => '/agent/default/repo');

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1');

    expect(result).toBe('/agent/default/repo');
    expect(mockCurrentAgentWorkingDirectory).toHaveBeenCalledWith('device-1');
  });

  it('falls back to the captured agent when agentId is provided', () => {
    mockGetTopicWorkingDirectory.mockReturnValue(undefined);
    mockGetAgentWorkingDirectoryById.mockReturnValue('/agent-captured/repo');

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1', 'agent-42');

    expect(result).toBe('/agent-captured/repo');
    expect(mockGetAgentWorkingDirectoryById).toHaveBeenCalledWith('agent-42', 'device-1');
    expect(mockCurrentAgentWorkingDirectory).not.toHaveBeenCalled();
  });

  it('returns undefined when no topic working directory, no agentId, and active agent has no working directory', () => {
    mockGetTopicWorkingDirectory.mockReturnValue(undefined);
    mockCurrentAgentWorkingDirectory.mockReturnValue(() => undefined);

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1');

    expect(result).toBeUndefined();
  });

  it('returns undefined when no topic working directory, agentId provided but agent has no working directory', () => {
    mockGetTopicWorkingDirectory.mockReturnValue(undefined);
    mockGetAgentWorkingDirectoryById.mockReturnValue(undefined);

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1', 'agent-42');

    expect(result).toBeUndefined();
  });

  it('prefers topic working directory over captured agentId fallback', () => {
    mockGetTopicWorkingDirectory.mockReturnValue('/topic/overrides/everything');
    mockGetAgentWorkingDirectoryById.mockReturnValue('/agent-captured/repo');

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1', 'agent-42');

    expect(result).toBe('/topic/overrides/everything');
    expect(mockGetAgentWorkingDirectoryById).not.toHaveBeenCalled();
  });
});
