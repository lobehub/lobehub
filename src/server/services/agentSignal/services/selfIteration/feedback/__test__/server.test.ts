// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentSelfFeedbackIntentDeclared } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import type * as ExecuteModule from '../../execute';
import { ActionStatus, ReviewRunStatus } from '../../types';
import { createSelfFeedbackIntentSourceHandler } from '../handler';
import { createServerSelfFeedbackIntentPolicyOptions } from '../server';

const mocks = vi.hoisted(() => ({
  executeSelfIteration: vi.fn(),
  initModelRuntimeFromDB: vi.fn(async () => ({ chat: vi.fn() })),
  persistAgentSignalReceipts: vi.fn(async () => {}),
  redisTryDedupe: vi.fn(async () => true),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
}));

vi.mock('@/database/models/agentSignal/reviewContext', () => ({
  AgentSignalReviewContextModel: class {
    canAgentRunSelfIteration = vi.fn(async () => true);
  },
}));

vi.mock('@/server/services/agentSignal/store/adapters/redis/sourceEventStore', () => ({
  redisSourceEventStore: {
    readWindow: vi.fn(async () => undefined),
    tryDedupe: mocks.redisTryDedupe,
    writeWindow: vi.fn(async () => undefined),
  },
}));

vi.mock('../../../receiptService', () => ({
  createSelfFeedbackReceipts: vi.fn(({ plan, result, selfIteration, sourceId }) => [
    {
      agentId: 'agent-1',
      detail: plan.summary,
      id: `${sourceId}:review-summary`,
      kind: 'review',
      metadata: { selfIteration },
      sourceId,
      status: result.status,
      title: plan.summary,
      userId: 'user-1',
    },
  ]),
  persistAgentSignalReceipts: mocks.persistAgentSignalReceipts,
}));

vi.mock('../../execute', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecuteModule>()),
  executeSelfIteration: mocks.executeSelfIteration,
}));

const intentPayload = {
  action: 'write',
  agentId: 'agent-1',
  confidence: 0.94,
  evidenceRefs: [{ id: 'msg-1', summary: 'Remember concise release summaries.', type: 'message' }],
  kind: 'memory',
  reason: 'The user gave a durable preference.',
  summary: 'User prefers concise release summaries.',
  toolCallId: 'tool-call-1',
  topicId: 'topic-1',
  userId: 'user-1',
} as const;

const intentSourceId = 'self-feedback-intent:user-1:agent-1:topic:topic-1:tool-call-1';

const createIntentSource = (): SourceAgentSelfFeedbackIntentDeclared =>
  createSource({
    payload: intentPayload,
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'topic:topic-1',
    sourceId: intentSourceId,
    sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
    timestamp: 100,
  }) as SourceAgentSelfFeedbackIntentDeclared;

describe('createServerSelfFeedbackIntentPolicyOptions', () => {
  /**
   * @example
   * expect(mocks.executeSelfIteration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'feedback' }));
   * expect(mocks.executeSelfIteration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'feedback' }));
   */
  it('runs declared intent through the self-iteration executor', async () => {
    mocks.executeSelfIteration.mockResolvedValue({
      actions: [
        {
          result: {
            resourceId: 'memory-1',
            status: 'applied',
            summary: 'Memory written.',
          },
          toolName: 'writeMemory',
        },
      ],
      content: 'Runtime intent wrote one memory.',
      ideas: [],
      intents: [],
      status: ReviewRunStatus.Completed,
      stepCount: 1,
      toolCalls: [],
      usage: [],
      writeOutcomes: [
        {
          result: {
            resourceId: 'memory-1',
            status: 'applied',
            summary: 'Memory written.',
          },
          toolName: 'writeMemory',
        },
      ],
    });

    const options = createServerSelfFeedbackIntentPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });
    const handler = createSelfFeedbackIntentSourceHandler(options);
    const result = await handler.handle(createIntentSource());

    expect(mocks.initModelRuntimeFromDB).toHaveBeenCalledTimes(1);
    expect(mocks.executeSelfIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        mode: 'feedback',
        sourceId: intentSourceId,
        userId: 'user-1',
      }),
    );
    expect(mocks.executeSelfIteration.mock.calls[0]?.[0].tools).toEqual(
      expect.objectContaining({
        getEvidenceDigest: expect.any(Function),
        writeMemory: expect.any(Function),
      }),
    );
    expect(mocks.persistAgentSignalReceipts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: `${intentSourceId}:review-summary`,
        metadata: expect.objectContaining({
          selfIteration: expect.objectContaining({
            mode: 'feedback',
            sourceId: intentSourceId,
          }),
        }),
      }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        plannedActionCount: 1,
        status: ReviewRunStatus.Completed,
      }),
    );
    expect(result.execution?.actions[0]).toEqual(
      expect.objectContaining({
        resourceId: 'memory-1',
        status: ActionStatus.Applied,
      }),
    );
  });
});
