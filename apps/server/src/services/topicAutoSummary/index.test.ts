import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TopicAutoSummaryService } from './index';

const mocks = vi.hoisted(() => ({
  analyzeTopic: vi.fn(),
  generateObject: vi.fn(),
  isTopicAnalysisEnabled: vi.fn(),
  saveTopicAnalysis: vi.fn(),
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
    mocks.isTopicAnalysisEnabled.mockReturnValue(false);
    mocks.analyzeTopic.mockResolvedValue(null);
    mocks.saveTopicAnalysis.mockResolvedValue(undefined);
  });

  it('rolls the previous summary into the next bounded summary', async () => {
    const service = new TopicAutoSummaryService(createDb(), 'user-1');

    const result = await service.summarize('topic-1');

    expect(result).toEqual({ analyzed: false, summarized: true });
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

    expect(result).toEqual({ analyzed: false, summarized: true });
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

  describe('topic analysis', () => {
    const analysis = {
      category: 'coding',
      intent: 'doing',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      taxonomyVersion: 'v1',
    };

    beforeEach(() => {
      mocks.isTopicAnalysisEnabled.mockReturnValue(true);
      mocks.analyzeTopic.mockResolvedValue(analysis);
    });

    it('does not analyze when the deployment has no analysis', async () => {
      mocks.isTopicAnalysisEnabled.mockReturnValue(false);
      const service = new TopicAutoSummaryService(createDb(), 'user-1');

      const result = await service.summarize('topic-1');

      expect(result).toEqual({ analyzed: false, summarized: true });
      expect(mocks.analyzeTopic).not.toHaveBeenCalled();
      expect(mocks.saveTopicAnalysis).not.toHaveBeenCalled();
    });

    it('analyzes the summarized transcript with the summary model and saves the snapshot', async () => {
      const service = new TopicAutoSummaryService(createDb(), 'user-1', 'ws-1');

      const result = await service.summarize('topic-1');

      expect(result).toEqual({ analyzed: true, summarized: true });
      expect(mocks.analyzeTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'deepseek-v4-flash',
          provider: 'deepseek',
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
      });
    });

    it('keeps the summary when the analysis fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.analyzeTopic.mockRejectedValue(new Error('provider down'));
      const service = new TopicAutoSummaryService(createDb(), 'user-1');

      const result = await service.summarize('topic-1');

      expect(result).toEqual({ analyzed: false, summarized: true });
      expect(mocks.saveTopicAnalysis).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('records nothing when the analysis has no result', async () => {
      mocks.analyzeTopic.mockResolvedValue(null);
      const service = new TopicAutoSummaryService(createDb(), 'user-1');

      const result = await service.summarize('topic-1');

      expect(result).toEqual({ analyzed: false, summarized: true });
      expect(mocks.saveTopicAnalysis).not.toHaveBeenCalled();
    });

    it('does not analyze a topic whose summary went stale', async () => {
      mocks.updateSummaryIfCurrent.mockResolvedValue(false);
      const service = new TopicAutoSummaryService(createDb(), 'user-1');

      const result = await service.summarize('topic-1');

      expect(result).toEqual({ reason: 'stale', summarized: false });
      expect(mocks.analyzeTopic).not.toHaveBeenCalled();
    });
  });
});
