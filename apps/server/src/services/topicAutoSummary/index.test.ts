import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TopicAutoSummaryService } from './index';

const mocks = vi.hoisted(() => ({
  analyzeTopic: vi.fn(),
  generateObject: vi.fn(),
  isTopicAnalysisEnabled: vi.fn(),
  saveTopicAnalysis: vi.fn(),
  snapshotTopicUsage: vi.fn(),
  getUserSettings: vi.fn(),
  resolveSystemAgentModelConfig: vi.fn(),
  updateSummaryIfCurrent: vi.fn(),
}));

vi.mock('@/business/server/topicAnalysis', () => ({
  analyzeTopic: mocks.analyzeTopic,
  isTopicAnalysisEnabled: mocks.isTopicAnalysisEnabled,
}));
vi.mock('@/database/models/topicAnalysis', () => ({
  TopicAnalysisModel: class {
    save = mocks.saveTopicAnalysis;
    snapshotTopicUsage = mocks.snapshotTopicUsage;
  },
}));
vi.mock('@/database/models/topicSummary', () => ({
  TopicSummaryModel: class {
    updateSummaryIfCurrent = mocks.updateSummaryIfCurrent;
  },
  topicSummaryEligibleMessage: undefined,
}));
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = mocks.getUserSettings;
  },
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = mocks.generateObject;
  },
}));
vi.mock('@/server/services/systemAgent/modelConfig', () => ({
  resolveSystemAgentModelConfig: mocks.resolveSystemAgentModelConfig,
}));

const createDb = (
  results: unknown[][] = [
    [{ historySummary: 'Earlier decision: use PostgreSQL.', senderId: null }],
    [
      {
        content: 'What is next?',
        id: 'message-1',
        role: 'user',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
      },
    ],
  ],
) => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => results.shift()),
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => results.shift()) })),
        })),
      })),
    })),
  };

  return db as typeof db & LobeChatDatabase;
};

describe('TopicAutoSummaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: { topicAutoSummary: { enabled: true } },
    });
    mocks.generateObject.mockResolvedValue({ description: 'Next steps', summary: 'Combined' });
    mocks.resolveSystemAgentModelConfig.mockResolvedValue({
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    });
    mocks.updateSummaryIfCurrent.mockResolvedValue(true);
  });

  it('rolls the previous summary into the next bounded summary', async () => {
    const service = new TopicAutoSummaryService(createDb(), 'user-1');

    const result = await service.summarize('topic-1');

    expect(result).toEqual({ summarized: true });
    const request = mocks.generateObject.mock.calls[0][0];
    expect(request.messages[1].content).toContain(
      'Previous rolling summary:\nEarlier decision: use PostgreSQL.',
    );
    expect(request.messages[1].content).toContain('Recent conversation:\nUSER: What is next?');
    expect(mocks.generateObject.mock.calls[0][1]).toEqual({
      metadata: { trigger: 'topic_summary' },
      tracing: {
        promptVersion: 'v1',
        scenario: 'topic_auto_summary',
        schemaName: 'topic_auto_summary',
        topicId: 'topic-1',
      },
    });
  });

  it('skips a user who never opted in', async () => {
    mocks.getUserSettings.mockResolvedValue({});
    const service = new TopicAutoSummaryService(createDb(), 'user-1');

    const result = await service.summarize('topic-1');

    expect(result).toEqual({ reason: 'disabled', summarized: false });
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it('skips a share-visitor topic without invoking generation', async () => {
    // The topic row load returns a non-null senderId → visitor conversation.
    // These are creator-billed only through the share spend gate, so the
    // auto-summary worker must never call the LLM for them.
    const db = createDb([[{ historySummary: null, senderId: 'visitor-9' }]]);
    const service = new TopicAutoSummaryService(db, 'creator-1');

    const result = await service.summarize('shared-topic');

    expect(result).toEqual({ reason: 'disabled', summarized: false });
    expect(mocks.generateObject).not.toHaveBeenCalled();
    expect(mocks.updateSummaryIfCurrent).not.toHaveBeenCalled();
  });

  it('stops before reading messages or resolving a model when the topic was trashed', async () => {
    const db = createDb([[]]);
    const service = new TopicAutoSummaryService(db, 'user-1');

    const result = await service.summarize('trashed-topic');

    expect(result).toEqual({ reason: 'stale', summarized: false });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(mocks.resolveSystemAgentModelConfig).not.toHaveBeenCalled();
    expect(mocks.generateObject).not.toHaveBeenCalled();
    expect(mocks.updateSummaryIfCurrent).not.toHaveBeenCalled();
  });

  it('still summarizes an opted-out user when forced', async () => {
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: { topicAutoSummary: { enabled: false } },
    });
    const service = new TopicAutoSummaryService(createDb(), 'user-1');

    const result = await service.summarize('topic-1', { force: true });

    expect(result).toEqual({ summarized: true });
    expect(mocks.generateObject).toHaveBeenCalled();
  });

  it('skips the summary when a device-only model has no tab to run in', async () => {
    mocks.generateObject.mockRejectedValue({
      error: { reason: 'no_executor', recoverable: true },
      errorType: 'ClientLlmExecutorUnavailable',
      provider: 'ollama',
    });
    const service = new TopicAutoSummaryService(createDb(), 'user-1');

    const result = await service.summarize('topic-1', { force: true });

    expect(result).toEqual({ reason: 'no-executor', summarized: false });
    expect(mocks.updateSummaryIfCurrent).not.toHaveBeenCalled();
  });

  it('still fails the step on any other generation error', async () => {
    mocks.generateObject.mockRejectedValue(new Error('provider down'));
    const service = new TopicAutoSummaryService(createDb(), 'user-1');

    await expect(service.summarize('topic-1', { force: true })).rejects.toThrow('provider down');
  });

  describe('analyze', () => {
    const analysis = {
      category: 'coding',
      intent: 'doing',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      taxonomyVersion: 'v1',
    };
    const usage = { toolCalls: 2, totalTokens: 1000, userMessages: 1 };

    beforeEach(() => {
      mocks.isTopicAnalysisEnabled.mockReturnValue(true);
      mocks.analyzeTopic.mockResolvedValue(analysis);
      mocks.saveTopicAnalysis.mockResolvedValue({ id: 'row-1' });
      mocks.snapshotTopicUsage.mockResolvedValue(usage);
    });

    it('does nothing when the deployment has no topic analysis', async () => {
      mocks.isTopicAnalysisEnabled.mockReturnValue(false);
      const db = createDb();

      const result = await new TopicAutoSummaryService(db, 'user-1').analyze('topic-1');

      expect(result).toEqual({ analyzed: false, reason: 'disabled' });
      expect(mocks.getUserSettings).not.toHaveBeenCalled();
      expect(mocks.analyzeTopic).not.toHaveBeenCalled();
    });

    it('classifies the rolling summary and recent transcript and saves the snapshot', async () => {
      const service = new TopicAutoSummaryService(createDb(), 'user-1', 'ws-1');

      const result = await service.analyze('topic-1');

      expect(result).toEqual({ analyzed: true });
      expect(mocks.analyzeTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'deepseek-v4-flash',
          provider: 'deepseek',
          summary: 'Earlier decision: use PostgreSQL.',
          topicId: 'topic-1',
          transcript: 'USER: What is next?',
          userId: 'user-1',
          workspaceId: 'ws-1',
        }),
      );
      expect(mocks.saveTopicAnalysis).toHaveBeenCalledWith({
        lastMessageId: 'message-1',
        lastMessageUpdatedAt: new Date('2026-07-31T10:00:00Z'),
        result: analysis,
        topicId: 'topic-1',
        usage,
      });
      expect(mocks.snapshotTopicUsage).toHaveBeenCalledWith('topic-1');
      expect(mocks.generateObject).not.toHaveBeenCalled();
    });

    it('applies the same opt-in and visitor guards as the summary', async () => {
      mocks.getUserSettings.mockResolvedValue({});
      expect(await new TopicAutoSummaryService(createDb(), 'user-1').analyze('topic-1')).toEqual({
        analyzed: false,
        reason: 'disabled',
      });

      mocks.getUserSettings.mockResolvedValue({
        systemAgent: { topicAutoSummary: { enabled: true } },
      });
      const visitorDb = createDb([[{ historySummary: null, senderId: 'visitor-9' }]]);
      expect(await new TopicAutoSummaryService(visitorDb, 'creator-1').analyze('topic-1')).toEqual({
        analyzed: false,
        reason: 'disabled',
      });
      expect(mocks.analyzeTopic).not.toHaveBeenCalled();
    });

    it('records nothing when the analysis has no usable result', async () => {
      mocks.analyzeTopic.mockResolvedValue(null);

      const result = await new TopicAutoSummaryService(createDb(), 'user-1').analyze('topic-1');

      expect(result).toEqual({ analyzed: false, reason: 'invalid-output' });
      expect(mocks.saveTopicAnalysis).not.toHaveBeenCalled();
    });

    it('reports a stale result when a newer analysis is already stored', async () => {
      mocks.saveTopicAnalysis.mockResolvedValue(undefined);

      const result = await new TopicAutoSummaryService(createDb(), 'user-1').analyze('topic-1');

      expect(result).toEqual({ analyzed: false, reason: 'stale' });
    });

    it('skips device-only models and rethrows other failures for the step to retry', async () => {
      mocks.analyzeTopic.mockRejectedValueOnce({
        errorType: 'ClientLlmExecutorUnavailable',
      });
      expect(await new TopicAutoSummaryService(createDb(), 'user-1').analyze('topic-1')).toEqual({
        analyzed: false,
        reason: 'no-executor',
      });

      mocks.analyzeTopic.mockRejectedValueOnce(new Error('provider down'));
      await expect(
        new TopicAutoSummaryService(createDb(), 'user-1').analyze('topic-1'),
      ).rejects.toThrow('provider down');
      expect(mocks.saveTopicAnalysis).not.toHaveBeenCalled();
    });
  });
});
