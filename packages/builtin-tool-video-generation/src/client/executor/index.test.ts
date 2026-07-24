import { beforeEach, describe, expect, it, vi } from 'vitest';

import { videoGenerationExecutor } from './index';

const mocks = vi.hoisted(() => ({
  createTopic: vi.fn(),
  createVideo: vi.fn(),
  enabledVideoModelList: vi.fn(),
  getAgentStoreState: vi.fn(),
}));

vi.mock('@/services/aiModel', () => ({
  aiModelService: {},
}));
vi.mock('@/services/aiProvider', () => ({
  aiProviderService: {},
}));
vi.mock('@/services/generation', () => ({
  generationService: {},
}));
vi.mock('@/services/generationTopic', () => ({
  generationTopicService: {
    createTopic: mocks.createTopic,
  },
}));
vi.mock('@/services/video', () => ({
  videoService: {
    createVideo: mocks.createVideo,
  },
}));
vi.mock('@/store/agent', () => ({
  getAgentStoreState: mocks.getAgentStoreState,
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentById:
      (agentId: string) =>
      (state: { agentMap: Record<string, { visibility?: 'private' | 'public' }> }) =>
        state.agentMap[agentId],
  },
}));
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledVideoModelList: mocks.enabledVideoModelList,
  },
  getAiInfraStoreState: vi.fn(() => ({})),
}));

describe('VideoGenerationExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentStoreState.mockReturnValue({
      agentMap: {
        'agent-public': {
          visibility: 'public',
        },
      },
    });
    mocks.enabledVideoModelList.mockReturnValue([
      {
        children: [{ id: 'video-model-1' }],
        id: 'provider-1',
        name: 'Provider 1',
      },
    ]);
    mocks.createTopic.mockResolvedValue('topic-1');
    mocks.createVideo.mockResolvedValue({
      data: {
        batch: { id: 'batch-1' },
        generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }],
      },
      success: true,
    });
  });

  it('preserves public agent visibility for client-routed video topics', async () => {
    const result = await videoGenerationExecutor.generateVideo(
      {
        model: 'video-model-1',
        prompt: 'A shared workspace product animation',
        provider: 'provider-1',
        waitUntilComplete: false,
      },
      {
        agentId: 'agent-public',
        messageId: 'message-1',
      },
    );

    expect(result.success).toBe(true);
    expect(mocks.createTopic).toHaveBeenCalledWith(
      'video',
      'public',
      'A shared workspace product animation',
    );
  });
});
