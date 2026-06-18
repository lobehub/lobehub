// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { createServerSelfReflectionPolicyOptions } from '../server';

describe('createServerSelfReflectionPolicyOptions', () => {
  it('exposes dispatch-shaped handler deps (gate, guard, collector, db) without legacy runtime/receipt wiring', () => {
    const options = createServerSelfReflectionPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    expect(options.acquireReviewGuard).toEqual(expect.any(Function));
    expect(options.canRunReview).toEqual(expect.any(Function));
    expect(options.collectContext).toEqual(expect.any(Function));
    // The dispatch helper enqueues the run; the handler needs the db handle.
    expect(options.db).toBeDefined();
    // Self-iteration now runs via execAgent + the builtin serverRuntime — the old
    // inline runtime factory / receipt writers must be gone.
    expect('runtimeFactory' in options).toBe(false);
    expect('executeSelfIteration' in options).toBe(false);
    expect('writeReceipt' in options).toBe(false);
    expect('writeReceipts' in options).toBe(false);
  });

  it('rejects reviews whose payload user id does not match the policy owner', async () => {
    const options = createServerSelfReflectionPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    // userId mismatch short-circuits before any DB access.
    await expect(
      options.canRunReview({
        agentId: 'agent-1',
        guardKey: 'self-reflection:user-2:agent-1:topic:topic-1',
        reason: 'tool_failed',
        scopeId: 'topic-1',
        scopeType: 'topic',
        sourceId: 'self-reflection:user-2:agent-1:topic:topic-1',
        userId: 'user-2',
        windowEnd: '2026-05-11T01:00:00.000Z',
        windowStart: '2026-05-11T00:00:00.000Z',
      }),
    ).resolves.toBe(false);
  });
});
