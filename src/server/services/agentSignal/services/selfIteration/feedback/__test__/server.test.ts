// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import type { SelfFeedbackIntentSourceGuardInput } from '../handler';
import { createServerSelfFeedbackIntentPolicyOptions } from '../server';

const baseGuardInput: SelfFeedbackIntentSourceGuardInput = {
  action: 'write',
  agentId: 'agent-1',
  confidence: 0.9,
  evidenceRefs: [],
  guardKey: 'self-feedback-intent:user-1:agent-1:topic:topic-1:tool-call-1',
  kind: 'memory',
  reason: 'durable preference',
  scopeId: 'topic-1',
  scopeType: 'topic',
  sourceId: 'self-feedback-intent:user-1:agent-1:topic:topic-1:tool-call-1',
  summary: 'concise summaries',
  toolCallId: 'tool-call-1',
  topicId: 'topic-1',
  userId: 'user-1',
};

describe('createServerSelfFeedbackIntentPolicyOptions', () => {
  it('exposes dispatch-shaped handler deps (gate, guard, enricher, db) without legacy runtime/receipt wiring', () => {
    const options = createServerSelfFeedbackIntentPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    expect(options.acquireReviewGuard).toEqual(expect.any(Function));
    expect(options.canRunReview).toEqual(expect.any(Function));
    expect(options.enrichEvidence).toEqual(expect.any(Function));
    expect(options.db).toBeDefined();
    expect('runtimeFactory' in options).toBe(false);
    expect('executeSelfIteration' in options).toBe(false);
    expect('writeReceipt' in options).toBe(false);
    expect('writeReceipts' in options).toBe(false);
  });

  it('enriches with the scope evidence ref so it rides in the run prompt', async () => {
    const options = createServerSelfFeedbackIntentPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    await expect(
      options.enrichEvidence?.({
        action: 'write',
        agentId: 'agent-1',
        kind: 'memory',
        scopeId: 'topic-1',
        scopeType: 'topic',
        toolCallId: 'tool-call-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ evidenceRefs: [{ id: 'topic-1', type: 'topic' }] });
  });

  it('rejects declarations whose payload user id does not match the policy owner', async () => {
    const options = createServerSelfFeedbackIntentPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    // userId mismatch short-circuits before any DB access.
    await expect(
      options.canRunReview({ ...baseGuardInput, userId: 'user-2' }),
    ).resolves.toBe(false);
  });
});
