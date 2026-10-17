// @vitest-environment node
import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runMemoryActionAgent } from '../userMemory';

const { mockCreateOperation } = vi.hoisted(() => ({
  mockCreateOperation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return { createOperation: mockCreateOperation };
  }),
}));

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({
      enabledToolIds: [MemoryIdentifier],
      tools: [{ function: { name: 'memory' }, type: 'function' }],
    }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
}));

const marker = { kind: 'memory', sourceId: 'source-1' } as const;

const createOptions = () => {
  const messageModel = { create: vi.fn().mockResolvedValue({ id: 'msg-seed' }) };
  const threadModel = { create: vi.fn().mockResolvedValue({ id: 'thread-1' }) };

  return {
    messageModel,
    options: {
      agentService: {
        getAgentConfig: vi.fn().mockResolvedValue({
          chatConfig: {},
          model: 'glm-5.3-flash',
          provider: 'lobehub',
        }),
      },
      db: {} as never,
      messageModel,
      pluginModel: { query: vi.fn().mockResolvedValue([]) },
      threadModel,
      userId: 'user-1',
      userModel: { getUserSettings: vi.fn().mockResolvedValue(undefined) },
    } as never,
    threadModel,
  };
};

describe('runMemoryActionAgent seed prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the writer prompt in the isolation thread so a DB reload keeps it', async () => {
    const { messageModel, options } = createOptions();

    await runMemoryActionAgent(
      {
        agentId: 'agent-1',
        message: 'remember I prefer tabs',
        sourceMessageId: 'msg-assistant',
        topicId: 'topic-1',
      },
      options,
      { marker },
    );

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        role: 'user',
        threadId: 'thread-1',
        topicId: 'topic-1',
      }),
    );

    const params = mockCreateOperation.mock.calls[0][0];
    expect(params.initialMessages).toEqual([
      expect.objectContaining({ id: 'msg-seed', role: 'user' }),
    ]);
    // The first assistant message hangs under the persisted seed.
    expect(params.initialContext.payload.parentMessageId).toBe('msg-seed');
  });

  it('keeps the seed in memory only when no isolation thread exists', async () => {
    const { messageModel, options } = createOptions();

    await runMemoryActionAgent({ agentId: 'agent-1', message: 'remember I prefer tabs' }, options, {
      marker,
    });

    expect(messageModel.create).not.toHaveBeenCalled();

    const params = mockCreateOperation.mock.calls[0][0];
    expect(params.initialMessages).toEqual([{ content: expect.any(String), role: 'user' }]);
    expect(params.initialContext.payload.parentMessageId).toBeUndefined();
  });
});
