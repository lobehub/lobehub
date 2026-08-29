// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { TopicModel } from '@/database/models/topic';

import { acquireTopicStartReservation } from '../topicStartReservation';

// Real-Postgres reproduction of the topic-reservation race on `shareChat.ts:186`
//: "Serialize visitor sends on each topic".
//
// `AiAgentService.execAgent` claims the topic via
// `acquireTopicStartReservation` → `TopicModel.tryReserveTaskCallback` BEFORE
// it creates the operation and writes `topic.metadata.runningOperation`. When
// the caller passes `interactiveStart: true` (→ `ignoreRunningOperation:
// true`), that claim skips the `runningOperation` liveness check entirely and
// only contends on the short-lived `taskCallbackReservation`, which is
// released right after the operation is CREATED — long before it actually
// finishes running. `shareChat.ts`'s visitor-facing `execAgent` used to pass
// `interactiveStart: true` (copied from the trusted owner-facing
// `aiAgent.execAgent`, where the client's OWN queue/UI is what serializes
// sends). An untrusted visitor has no such client-side gate: firing two
// concurrent `execAgent` mutations at the same topic let BOTH claim the
// topic-start reservation in turn and both create creator-credentialed
// operations, with the second operation's `runningOperation` write silently
// overwriting the first's — orphaning the first operation (still consuming
// tools and the creator's share budget) beyond the reach of
// `shareChat.interruptTask` and `AiAgentService.interruptActiveShareRuns`'s
// revocation sweep, both of which resolve only the CURRENT marker.
//
// The fix (`apps/server/src/routers/lambda/shareChat.ts`) stops passing
// `interactiveStart: true` for the visitor path, so visitor sends now claim
// the topic the same way a background/task-callback start does: contending
// on the REAL `runningOperation` liveness, not just the short reservation.
// This test drives `acquireTopicStartReservation` directly (the exact
// mechanism `execAgent` calls) to prove that with `ignoreRunningOperation`
// left unset — the post-fix visitor behavior — a second concurrent start
// against a topic with a live operation is rejected instead of silently
// displacing the first.

const userId = 'share-visitor-concurrency-owner';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

const cleanup = async () => {
  await serverDB.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await serverDB.delete(topics).where(eq(topics.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('acquireTopicStartReservation — visitor concurrent-send race (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }]);
  });

  afterAll(cleanup);

  it('rejects a second concurrent visitor send while the first operation is still alive, so the first is never orphaned', async () => {
    const topicId = 'share-visitor-race-topic';
    const firstOperationId = 'share-visitor-race-op-first';

    // Operation A is genuinely running (mirrors the DB state right after
    // `execAgent` writes the topic's running-operation marker, well before
    // the run finishes).
    await serverDB.insert(agentOperations).values({
      id: firstOperationId,
      status: 'running',
      userId,
    });
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: {
        runningOperation: {
          assistantMessageId: 'assistant-first',
          operationId: firstOperationId,
          startedAt: new Date().toISOString(),
        },
      },
      title: 'Test',
      userId,
    });

    // A second visitor send for the SAME topic arrives while A is alive. Post
    // fix, `shareChat.ts` no longer sets `interactiveStart`/
    // `ignoreRunningOperation`, so this call must behave exactly like a
    // background start: it retries against the live `runningOperation` and
    // ultimately fails closed rather than claiming the topic.
    await expect(
      acquireTopicStartReservation({
        reservationId: 'share-visitor-race-op-second',
        topicId,
        topicModel,
      }),
    ).rejects.toThrow(`Topic ${topicId} remained busy`);

    // The topic's marker must still point at the FIRST operation — proving
    // the second send never got far enough to overwrite it and orphan A.
    const [topic] = await serverDB
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, topicId));
    expect(topic?.metadata?.runningOperation?.operationId).toBe(firstOperationId);
  }, 15_000);

  it('documents the pre-fix hole: an interactive-bypass send DOES claim the topic while the first operation is alive', async () => {
    // Same setup as above, but with `ignoreRunningOperation: true` — the
    // behavior `shareChat.ts` used to request via `interactiveStart: true`.
    // This is intentionally the OLD, vulnerable configuration: it must
    // succeed immediately, which is exactly what let a second visitor send
    // silently displace the first operation's `runningOperation` marker.
    const topicId = 'share-visitor-race-topic-prefix';
    const firstOperationId = 'share-visitor-race-op-first-prefix';

    await serverDB.insert(agentOperations).values({
      id: firstOperationId,
      status: 'running',
      userId,
    });
    await serverDB.insert(topics).values({
      id: topicId,
      metadata: {
        runningOperation: {
          assistantMessageId: 'assistant-first',
          operationId: firstOperationId,
          startedAt: new Date().toISOString(),
        },
      },
      title: 'Test',
      userId,
    });

    await expect(
      acquireTopicStartReservation({
        ignoreRunningOperation: true,
        reservationId: 'share-visitor-race-op-second-prefix',
        topicId,
        topicModel,
      }),
    ).resolves.toBe(true);
  });
});
