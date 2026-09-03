import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicAutoSummaryService } from './index';

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  getUserSettings: vi.fn(),
  updateSummaryIfCurrent: vi.fn(),
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
  resolveSystemAgentModelConfig: vi.fn().mockResolvedValue({
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
  }),
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
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => results.shift()),
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => results.shift()) })),
        })),
      })),
    })),
  } as never;
};

describe('TopicAutoSummaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: { topicAutoSummary: { enabled: true } },
    });
    mocks.generateObject.mockResolvedValue({ description: 'Next steps', summary: 'Combined' });
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

  it('still summarizes an opted-out user when forced', async () => {
    mocks.getUserSettings.mockResolvedValue({
      systemAgent: { topicAutoSummary: { enabled: false } },
    });
    const service = new TopicAutoSummaryService(createDb(), 'user-1');

    const result = await service.summarize('topic-1', { force: true });

    expect(result).toEqual({ summarized: true });
    expect(mocks.generateObject).toHaveBeenCalled();
  });
});
