// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it, vi } from 'vitest';

import { createCompletionPolicy } from '../../../../policies/completionPolicy';
import type { AgentSignalReceipt, AgentSignalReceiptStore } from '../../../receiptService';
import type { SelfIterationCompletionPayload } from '../extractCompletionPayload';
import { createSelfIterationCompletionHandler } from '../selfIterationCompletionHandler';

/**
 * Exercises the whole S2 completion loop in-process with the REAL wiring:
 * completion policy source handler → onSelfIterationCompleted → receipt
 * projection → persist. Only the finalState extraction is synthesized here (it
 * is covered by extractCompletionPayload.test.ts); everything downstream is the
 * production code path.
 */

interface CapturedHandler {
  handle: (source: { payload: Record<string, unknown> }) => Promise<void>;
  id: string;
  listen: string;
}

const installAndCapture = (middleware: ReturnType<typeof createCompletionPolicy>) => {
  const sourceHandlers: CapturedHandler[] = [];
  middleware.install({
    handleAction: vi.fn(),
    handleSignal: vi.fn(),
    handleSource: (handler: unknown) => {
      sourceHandlers.push(handler as CapturedHandler);
    },
  } as never);
  return sourceHandlers;
};

/** In-memory receipt store mirroring the real store's append-once dedupe. */
const makeInMemoryReceiptStore = () => {
  const appended: AgentSignalReceipt[] = [];
  const seen = new Set<string>();
  const store: AgentSignalReceiptStore = {
    appendReceipt: async (receipt) => {
      if (seen.has(receipt.id)) return false;
      seen.add(receipt.id);
      appended.push(receipt);
      return true;
    },
    listReceipts: async () => ({ receipts: [] }),
  };
  return { appended, store };
};

const selfIteration: SelfIterationCompletionPayload = {
  artifacts: [{ apiName: 'recordSelfReviewIdea', data: { idea: 'try x' }, kind: 'artifact' }],
  marker: {
    anchorMessageId: 'msg_anchor',
    kind: 'nightly-review',
    localDate: '2026-05-30',
    sourceId: 'nightly-review:user_1:agent_1:2026-05-30',
  },
  mutations: [
    {
      apiName: 'writeMemory',
      data: { resourceId: 'mem_1', summary: 'Saved tone preference' },
      kind: 'mutation',
      toolCallId: 'call_mem',
    },
    {
      apiName: 'createSelfReviewProposal',
      data: { proposalId: 'brf_1', summary: 'Refine skill X' },
      kind: 'mutation',
      toolCallId: 'call_prop',
    },
  ],
  userId: 'user_1',
};

const completedPayload = {
  agentId: BUILTIN_AGENT_SLUGS.nightlyReview,
  operationId: 'op_1',
  selfIteration,
  topicId: 'topic_1',
};

describe('S2 completion loop (policy → handler → projection → persist)', () => {
  it('projects + persists receipts for a completed self-iteration run', async () => {
    const { appended, store } = makeInMemoryReceiptStore();
    const [handler] = installAndCapture(
      createCompletionPolicy({
        onSelfIterationCompleted: createSelfIterationCompletionHandler({ receiptStore: store }),
      }),
    );

    await handler.handle({ payload: completedPayload });

    // summary + one receipt per mutation
    expect(appended.map((r) => r.kind)).toEqual(['review', 'memory', 'review']);

    const memory = appended.find((r) => r.kind === 'memory')!;
    expect(memory.status).toBe('applied');
    expect(memory.topicId).toBe('topic_1');
    expect(memory.anchorMessageId).toBe('msg_anchor');
    expect(memory.target).toMatchObject({ id: 'mem_1', type: 'memory' });

    const proposal = appended.find((r) => r.id.includes('call_prop'))!;
    expect(proposal.kind).toBe('review');
    expect(proposal.status).toBe('proposed');
    expect(proposal.target).toBeUndefined();
  });

  it('is idempotent: replaying the same completion adds no duplicate receipts', async () => {
    const { appended, store } = makeInMemoryReceiptStore();
    const [handler] = installAndCapture(
      createCompletionPolicy({
        onSelfIterationCompleted: createSelfIterationCompletionHandler({ receiptStore: store }),
      }),
    );

    await handler.handle({ payload: completedPayload });
    const countAfterFirst = appended.length;
    await handler.handle({ payload: completedPayload });

    expect(appended).toHaveLength(countAfterFirst);
  });

  it('projects a single memory receipt (no summary) with target + anchor for a memory-kind run', async () => {
    // A memory-writer run dispatched async by handleUserMemoryAction: it carries
    // a `memory` marker (extractMemoryMutations synthesizes the writeMemory
    // mutation from finalState). The receipt must still appear with the right
    // target + anchor — the async replacement for the old synchronous projection.
    const { appended, store } = makeInMemoryReceiptStore();
    const [handler] = installAndCapture(
      createCompletionPolicy({
        onSelfIterationCompleted: createSelfIterationCompletionHandler({ receiptStore: store }),
      }),
    );

    const memoryPayload: Record<string, unknown> = {
      // A memory run executes as the user's own agent, not a builtin slug.
      agentId: 'agent_user_1',
      operationId: 'op_mem',
      selfIteration: {
        artifacts: [],
        marker: {
          anchorMessageId: 'assistant_msg_1',
          kind: 'memory',
          sourceId: 'source_1:action-memory-1',
          triggerMessageId: 'user_msg_1',
        },
        mutations: [
          {
            apiName: 'writeMemory',
            data: { resourceId: 'mem_1', status: 'applied', summary: 'Saved tone preference' },
            kind: 'mutation',
          },
        ],
        userId: 'user_1',
      },
      topicId: 'topic_1',
    };

    await handler.handle({ payload: memoryPayload });

    // A single memory write surfaces as just its action receipt — no aggregate
    // review summary (that is only for nightly-review / reflection runs).
    expect(appended).toHaveLength(1);
    const memory = appended[0];
    expect(memory.kind).toBe('memory');
    expect(memory.status).toBe('applied');
    expect(memory.anchorMessageId).toBe('assistant_msg_1');
    expect(memory.triggerMessageId).toBe('user_msg_1');
    expect(memory.topicId).toBe('topic_1');
    expect(memory.target).toMatchObject({ id: 'mem_1', type: 'memory' });
  });

  it('no-ops when the completion carries no self-iteration payload (no marker stamped)', async () => {
    const { appended, store } = makeInMemoryReceiptStore();
    const [handler] = installAndCapture(
      createCompletionPolicy({
        onSelfIterationCompleted: createSelfIterationCompletionHandler({ receiptStore: store }),
      }),
    );

    await handler.handle({
      payload: {
        agentId: BUILTIN_AGENT_SLUGS.nightlyReview,
        operationId: 'op_2',
        topicId: 'topic_2',
      },
    });

    expect(appended).toHaveLength(0);
  });
});
