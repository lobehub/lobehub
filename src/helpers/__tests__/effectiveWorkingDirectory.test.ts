import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveEffectiveWorkingDirectory } from '../effectiveWorkingDirectory';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDesktop: true,
}));

const mockGetElectronStoreState = vi.fn();
vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => mockGetElectronStoreState(),
}));

const mockGetAgentWorkingDirectory = vi.fn();
vi.mock('@/store/agent', () => ({
  getAgentWorkingDirectory: (agentId?: string | null, deviceId?: string) =>
    mockGetAgentWorkingDirectory(agentId, deviceId),
}));

const mockGetChatTopic = vi.fn();
vi.mock('@/projection', () => ({
  getChatProjection: (selector: (scope: object) => unknown) => selector({}),
  selectChatTopicItem: (_scope: object, topicId: string) => mockGetChatTopic(topicId),
}));

describe('resolveEffectiveWorkingDirectory', () => {
  const chatState = { activeAgentId: 'active-agent' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetElectronStoreState.mockReturnValue({
      gatewayDeviceInfo: { deviceId: 'device-1' },
    });
  });

  it('returns the topic working directory when one is configured', () => {
    mockGetChatTopic.mockReturnValue({
      metadata: { workingDirectory: '/home/user/project' },
    });

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1');

    expect(result).toBe('/home/user/project');
    expect(mockGetChatTopic).toHaveBeenCalledWith('topic-1');
  });

  it('falls back to the active agent when no topic working directory and no agentId', () => {
    mockGetChatTopic.mockReturnValue(undefined);
    mockGetAgentWorkingDirectory.mockReturnValue('/agent/default/repo');

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1');

    expect(result).toBe('/agent/default/repo');
    expect(mockGetAgentWorkingDirectory).toHaveBeenCalledWith('active-agent', 'device-1');
  });

  it('falls back to the captured agent when agentId is provided', () => {
    mockGetChatTopic.mockReturnValue(undefined);
    mockGetAgentWorkingDirectory.mockReturnValue('/agent-captured/repo');

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1', 'agent-42');

    expect(result).toBe('/agent-captured/repo');
    expect(mockGetAgentWorkingDirectory).toHaveBeenCalledWith('agent-42', 'device-1');
  });

  it('returns undefined when no topic working directory, no agentId, and active agent has no working directory', () => {
    mockGetChatTopic.mockReturnValue(undefined);
    mockGetAgentWorkingDirectory.mockReturnValue(undefined);

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1');

    expect(result).toBeUndefined();
  });

  it('returns undefined when no topic working directory, agentId provided but agent has no working directory', () => {
    mockGetChatTopic.mockReturnValue(undefined);
    mockGetAgentWorkingDirectory.mockReturnValue(undefined);

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1', 'agent-42');

    expect(result).toBeUndefined();
  });

  it('prefers topic working directory over captured agentId fallback', () => {
    mockGetChatTopic.mockReturnValue({
      metadata: { workingDirectory: '/topic/overrides/everything' },
    });
    mockGetAgentWorkingDirectory.mockReturnValue('/agent-captured/repo');

    const result = resolveEffectiveWorkingDirectory(chatState, 'topic-1', 'agent-42');

    expect(result).toBe('/topic/overrides/everything');
    expect(mockGetAgentWorkingDirectory).not.toHaveBeenCalled();
  });
});
