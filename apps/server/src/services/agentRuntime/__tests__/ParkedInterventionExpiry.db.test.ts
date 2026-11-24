// @vitest-environment node
import {
  agentInterventions,
  agentOperations,
  messagePlugins,
  messages,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXPIRED_TOOL_CONTENT,
  PARKED_INTERVENTION_TTL_MS,
  ParkedInterventionExpiry,
} from '../ParkedInterventionExpiry';

const runtime = vi.hoisted(() => ({
  completeGroupActionMember: vi.fn(),
  loadGroupMemberBridge: vi.fn(),
}));

vi.mock('../AgentRuntimeService', () => ({
  // A class, so `new` works under every Vitest version (an arrow mock is not constructible).
  AgentRuntimeService: class {
    constructor() {
      return runtime;
    }
  },
}));

const db = await getTestDB();
const userId = 'parked-expiry-user';
const topicId = 'tpc_parked';
const operationId = 'op_parked';
const cardId = 'msg_card';
const batchId = `${operationId}:1:msg_assistant`;

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60_000);

/**
 * One run parked on an `askUserQuestion` card, shaped like the production row
 * from T-14854: pending card, `waiting_for_human` operation, `waitingForHuman`
 * topic without a running-operation marker, and a Cloud v2 intervention row
 * with no deadline.
 */
const seedParkedRun = async ({
  metadata,
  parkedAt = hoursAgo(25),
  runningOperation,
}: { metadata?: Record<string, unknown>; parkedAt?: Date; runningOperation?: boolean } = {}) => {
  await db.insert(topics).values({
    id: topicId,
    metadata: runningOperation
      ? { runningOperation: { assistantMessageId: 'msg_assistant', operationId } }
      : {},
    status: 'waitingForHuman',
    userId,
  } as never);
  await db.insert(agentOperations).values({
    createdAt: parkedAt,
    id: operationId,
    metadata,
    status: 'waiting_for_human',
    topicId,
    updatedAt: parkedAt,
    userId,
  });
  await db.insert(messages).values({
    content: '',
    id: cardId,
    role: 'tool',
    topicId,
    userId,
  });
  await db.insert(messagePlugins).values({
    apiName: 'askUserQuestion',
    id: cardId,
    identifier: 'lobe-user-interaction',
    intervention: { batchId, itemIndex: 0, operationId, status: 'pending', stepIndex: 1 },
    toolCallId: 'call_1',
    userId,
  } as never);
  await db.insert(agentInterventions).values({
    activityKey: 'activity',
    allowedActions: [],
    batchId,
    deadline: new Date('9999-12-31T23:59:59.999Z'),
    interactionKind: 'question',
    itemCount: 1,
    itemIndex: 0,
    operationId,
    requestRevisionHash: 'a'.repeat(64),
    reviewContext: {},
    reviewTokenHash: 'b'.repeat(64),
    sanitizedRequest: {},
    source: 'runtime',
    stepIndex: 1,
    surface: 'form',
    systemActionEligibility: 'none',
    toolCallId: 'call_1',
    toolMessageId: cardId,
    userId,
  } as never);
};

const snapshot = async () => {
  const [card] = await db
    .select({ content: messages.content, intervention: messagePlugins.intervention })
    .from(messages)
    .innerJoin(messagePlugins, eq(messagePlugins.id, messages.id))
    .where(eq(messages.id, cardId));
  const [operation] = await db
    .select({
      completedAt: agentOperations.completedAt,
      completionReason: agentOperations.completionReason,
      status: agentOperations.status,
    })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId));
  const [topic] = await db
    .select({ metadata: topics.metadata, status: topics.status })
    .from(topics)
    .where(eq(topics.id, topicId));
  const [v2] = await db
    .select({ status: agentInterventions.status })
    .from(agentInterventions)
    .where(eq(agentInterventions.operationId, operationId));
  return { card, operation, topic, v2 };
};

describe('ParkedInterventionExpiry (real database)', () => {
  beforeEach(async () => {
    // Operations do not cascade from their user.
    await db.delete(agentOperations);
    await db.delete(users);
    await db.insert(users).values({ id: userId });
    vi.clearAllMocks();
  });

  it('ends a run parked past the TTL the way Stop does', async () => {
    await seedParkedRun();

    const result = await new ParkedInterventionExpiry(db).sweep();

    expect(result).toEqual({ answered: 0, examined: 1, expired: 1, failed: 0 });
    const after = await snapshot();
    expect(after.card).toEqual({
      content: EXPIRED_TOOL_CONTENT,
      // Identity is kept so clients still match the row to their pending card.
      intervention: expect.objectContaining({ batchId, operationId, status: 'aborted' }),
    });
    expect(after.operation).toMatchObject({
      completionReason: 'interrupted',
      status: 'interrupted',
    });
    expect(after.operation.completedAt).toBeInstanceOf(Date);
    expect(after.topic.status).toBe('active');
    expect(after.v2.status).toBe('session_ended');
  });

  it('clears the topic running-operation marker that names the run', async () => {
    await seedParkedRun({ runningOperation: true });

    await new ParkedInterventionExpiry(db).sweep();

    const { topic } = await snapshot();
    expect(topic.status).toBe('active');
    expect(topic.metadata?.runningOperation).toBeNull();
  });

  it('leaves a run parked for less than the TTL alone', async () => {
    await seedParkedRun({ parkedAt: hoursAgo(23) });

    const result = await new ParkedInterventionExpiry(db).sweep();

    expect(result.examined).toBe(0);
    const after = await snapshot();
    expect(after.card.intervention?.status).toBe('pending');
    expect(after.operation.status).toBe('waiting_for_human');
    expect(after.topic.status).toBe('waitingForHuman');
  });

  it('leaves a run alone while a v2 answer is in flight', async () => {
    await seedParkedRun();
    await db
      .update(agentInterventions)
      .set({ status: 'resolving' })
      .where(eq(agentInterventions.operationId, operationId));

    const result = await new ParkedInterventionExpiry(db).sweep();

    expect(result).toMatchObject({ answered: 1, expired: 0 });
    const after = await snapshot();
    expect(after.card.intervention?.status).toBe('pending');
    expect(after.operation.status).toBe('waiting_for_human');
  });

  it('does not hand the topic back while a newer run owns it', async () => {
    await seedParkedRun();
    await db.insert(agentOperations).values({
      createdAt: hoursAgo(1),
      id: 'op_newer',
      status: 'running',
      topicId,
      userId,
    });

    await new ParkedInterventionExpiry(db).sweep();

    const after = await snapshot();
    expect(after.operation.status).toBe('interrupted');
    expect(after.card.intervention?.status).toBe('aborted');
    expect(after.topic.status).toBe('waitingForHuman');
  });

  it('does not hand the topic back while an older live run still owns it', async () => {
    await seedParkedRun();
    await db.insert(agentOperations).values({
      createdAt: hoursAgo(30),
      id: 'op_root',
      status: 'waiting_for_async_tool',
      topicId,
      userId,
    });

    await new ParkedInterventionExpiry(db).sweep();

    const after = await snapshot();
    expect(after.operation.status).toBe('interrupted');
    expect(after.topic.status).toBe('waitingForHuman');
  });

  it('reports an expired group member to its supervisor as interrupted', async () => {
    const bridge = { groupToolMessageId: 'msg_group_tool', parentOperationId: 'op_supervisor' };
    await seedParkedRun({ metadata: { groupMemberBridge: bridge } });
    runtime.loadGroupMemberBridge.mockResolvedValue({ agentId: 'agt_member', bridge });

    const result = await new ParkedInterventionExpiry(db).sweep();

    expect(result.expired).toBe(1);
    expect(runtime.loadGroupMemberBridge).toHaveBeenCalledWith(operationId);
    expect(runtime.completeGroupActionMember).toHaveBeenCalledWith({
      ...bridge,
      operationId,
      reason: 'interrupted',
    });
  });

  it('keeps a group member parked when its supervisor report fails, and retries it', async () => {
    const bridge = { groupToolMessageId: 'msg_group_tool', parentOperationId: 'op_supervisor' };
    await seedParkedRun({ metadata: { groupMemberBridge: bridge } });
    runtime.loadGroupMemberBridge.mockResolvedValue({ agentId: 'agt_member', bridge });
    runtime.completeGroupActionMember.mockRejectedValueOnce(new Error('queue down'));

    const first = await new ParkedInterventionExpiry(db).sweep();

    expect(first).toMatchObject({ expired: 0, failed: 1 });
    expect((await snapshot()).operation.status).toBe('waiting_for_human');

    const second = await new ParkedInterventionExpiry(db).sweep();

    expect(second.expired).toBe(1);
    expect(runtime.completeGroupActionMember).toHaveBeenCalledTimes(2);
    expect((await snapshot()).operation.status).toBe('interrupted');
  });

  it('does not touch the group bridge for a run that is not a member', async () => {
    await seedParkedRun();

    await new ParkedInterventionExpiry(db).sweep();

    expect(runtime.loadGroupMemberBridge).not.toHaveBeenCalled();
  });

  it('leaves a run alone while an answer has no continuation yet', async () => {
    const bridge = { groupToolMessageId: 'msg_group_tool', parentOperationId: 'op_supervisor' };
    await seedParkedRun({ metadata: { groupMemberBridge: bridge } });
    // The answer claimed the card; its continuation is not created yet.
    await db
      .update(messagePlugins)
      .set({ intervention: { batchId, operationId, status: 'approved' } } as never)
      .where(eq(messagePlugins.id, cardId));

    const result = await new ParkedInterventionExpiry(db).sweep();

    expect(result).toMatchObject({ answered: 1, expired: 0 });
    expect((await snapshot()).operation.status).toBe('waiting_for_human');
    expect(runtime.loadGroupMemberBridge).not.toHaveBeenCalled();
  });

  it('retires an answered run whose continuation exists, leaving the member to it', async () => {
    const bridge = { groupToolMessageId: 'msg_group_tool', parentOperationId: 'op_supervisor' };
    await seedParkedRun({ metadata: { groupMemberBridge: bridge } });
    await db
      .update(messagePlugins)
      .set({ intervention: { batchId, operationId, status: 'approved' } } as never)
      .where(eq(messagePlugins.id, cardId));
    await db.insert(agentOperations).values({
      createdAt: hoursAgo(24.5),
      id: 'op_continuation',
      status: 'done',
      topicId,
      userId,
    });

    const result = await new ParkedInterventionExpiry(db).sweep();

    expect(result.expired).toBe(1);
    const after = await snapshot();
    expect(after.card.intervention?.status).toBe('approved');
    expect(after.operation.status).toBe('interrupted');
    expect(runtime.loadGroupMemberBridge).not.toHaveBeenCalled();
  });

  it('honours a custom TTL', async () => {
    await seedParkedRun({ parkedAt: hoursAgo(2) });

    const result = await new ParkedInterventionExpiry(db).sweep({ ttlMs: 60 * 60_000 });

    expect(result.expired).toBe(1);
    expect(PARKED_INTERVENTION_TTL_MS).toBe(24 * 60 * 60_000);
  });
});
