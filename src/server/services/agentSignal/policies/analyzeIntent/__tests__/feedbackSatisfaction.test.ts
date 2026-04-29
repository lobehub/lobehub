// @vitest-environment node
import type { SourceAgentUserMessage } from '@lobechat/agent-signal/source';
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { createRuntimeProcessorContext } from '../../../runtime/context';
import { createFeedbackSatisfactionJudgeProcessor } from '../feedbackSatisfaction';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

const createUserMessageSource = (
  sourceId: string,
  message: string,
  serializedContext = 'topic=repo-review;assistant_behavior=verbose',
  intents: SourceAgentUserMessage['payload']['intents'] = ['document', 'memory'],
): SourceAgentUserMessage => ({
  chain: { chainId: `chain:${sourceId}`, rootSourceId: sourceId },
  payload: {
    agentId: 'agent_1',
    documentPayload: { section: 'answer-style' },
    intents,
    memoryPayload: { preplanned: true },
    message,
    messageId: `msg:${sourceId}`,
    serializedContext,
    topicId: 'topic_1',
  },
  scopeKey: 'topic:thread_1',
  sourceId,
  sourceType: 'agent.user.message',
  timestamp: 1_710_000_000_000,
});

describe('feedbackSatisfactionJudge', () => {
  const mockGenerateObject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
      generateObject: mockGenerateObject,
    } as never);
  });

  it('uses the injected judge, passes only message and serializedContext, and skips guards', async () => {
    const getGuardState = vi.fn().mockResolvedValue({});
    const touchGuardState = vi.fn().mockResolvedValue({});
    const judge = {
      judgeSatisfaction: vi.fn().mockResolvedValue({
        confidence: 0.94,
        evidence: [{ cue: 'requested correction', excerpt: 'Cut the padding.' }],
        reason: 'explicit dissatisfaction with answer style',
        result: 'not_satisfied',
      }),
    };
    const ctx = createRuntimeProcessorContext({
      backend: {
        getGuardState,
        touchGuardState,
      },
      scopeKey: 'topic:thread_1',
    });

    const processor = createFeedbackSatisfactionJudgeProcessor({ judge });
    const result = await processor.handle(
      createUserMessageSource('source_1', 'Cut the padding.'),
      ctx,
    );

    expect(judge.judgeSatisfaction).toHaveBeenCalledWith({
      message: 'Cut the padding.',
      serializedContext: 'topic=repo-review;assistant_behavior=verbose',
    });
    expect(getGuardState).not.toHaveBeenCalled();
    expect(touchGuardState).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({
              agentId: 'agent_1',
              confidence: 0.94,
              evidence: [{ cue: 'requested correction', excerpt: 'Cut the padding.' }],
              message: 'Cut the padding.',
              messageId: 'msg:source_1',
              reason: 'explicit dissatisfaction with answer style',
              result: 'not_satisfied',
              serializedContext: 'topic=repo-review;assistant_behavior=verbose',
              sourceHints: {
                documentPayload: { section: 'answer-style' },
                intents: ['document', 'memory'],
                memoryPayload: { preplanned: true },
              },
              topicId: 'topic_1',
            }),
            signalType: 'signal.feedback.satisfaction',
          }),
        ],
        status: 'dispatch',
      }),
    );
  });

  it('uses the default model-backed judge when db and userId are provided', async () => {
    mockGenerateObject.mockResolvedValue({
      confidence: 0.88,
      evidence: [{ cue: 'positive approval', excerpt: 'This structure works.' }],
      reason: 'clear approval of the new structure',
      result: 'satisfied',
    });

    const ctx = createRuntimeProcessorContext({
      backend: {
        async getGuardState() {
          return {};
        },
        async touchGuardState() {
          return {};
        },
      },
      scopeKey: 'topic:thread_1',
    });

    const processor = createFeedbackSatisfactionJudgeProcessor({
      db: {} as LobeChatDatabase,
      model: 'gpt-test',
      provider: 'openai',
      userId: 'user_1',
    });
    const result = await processor.handle(
      createUserMessageSource('source_2', 'This structure works.'),
      ctx,
    );

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith({} as LobeChatDatabase, 'user_1', 'openai');
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('You are the satisfaction-judging step'),
            role: 'system',
          }),
          expect.objectContaining({
            content: expect.stringContaining(
              'serializedContext="topic=repo-review;assistant_behavior=verbose"',
            ),
            role: 'user',
          }),
        ],
        model: 'gpt-test',
      }),
      { metadata: { trigger: RequestTrigger.Memory } },
    );
    expect(result).toEqual(
      expect.objectContaining({
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({
              result: 'satisfied',
              reason: 'clear approval of the new structure',
            }),
          }),
        ],
      }),
    );
  });

  it('fails fast when no judge or runtime context is configured', () => {
    expect(() => createFeedbackSatisfactionJudgeProcessor()).toThrow(
      'Feedback satisfaction judge requires either an injected judge or both db and userId.',
    );
  });

  it('treats explicit skill merge requests as unsatisfied actionable feedback', async () => {
    const judge = {
      judgeSatisfaction: vi.fn(),
    };
    const ctx = createRuntimeProcessorContext({
      backend: {
        async getGuardState() {
          return {};
        },
        async touchGuardState() {
          return {};
        },
      },
      scopeKey: 'topic:thread_1',
    });
    const processor = createFeedbackSatisfactionJudgeProcessor({ judge });
    const result = await processor.handle(
      createUserMessageSource(
        'source_skill_merge',
        'The PR review checklist and release-risk checklist overlap; combine the repeated parts.',
        'topic=repo-review',
        ['skill'],
      ),
      ctx,
    );

    expect(judge.judgeSatisfaction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({
              reason: 'source hinted explicit skill-management change request',
              result: 'not_satisfied',
            }),
          }),
        ],
      }),
    );
  });

  it('treats skill reuse hints as satisfied weak positive feedback', async () => {
    const judge = {
      judgeSatisfaction: vi.fn(),
    };
    const ctx = createRuntimeProcessorContext({
      backend: {
        async getGuardState() {
          return {};
        },
        async touchGuardState() {
          return {};
        },
      },
      scopeKey: 'topic:thread_1',
    });
    const processor = createFeedbackSatisfactionJudgeProcessor({ judge });
    const result = await processor.handle(
      createUserMessageSource(
        'source_skill_reuse',
        '这个 review 流程挺好，下次也可以参考。',
        'topic=repo-review',
        ['skill'],
      ),
      ctx,
    );

    expect(judge.judgeSatisfaction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({
              reason: 'source hinted reusable skill or workflow feedback',
              result: 'satisfied',
            }),
          }),
        ],
      }),
    );
  });
});
