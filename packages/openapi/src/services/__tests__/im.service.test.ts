// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  agentOperations,
  messages,
  pushLiveActivities,
  pushTokens,
  topics,
  users,
  workspaces,
} from '@/database/schemas';

import { ImRestService } from '../im.service';

const { execAgentMock } = vi.hoisted(() => ({ execAgentMock: vi.fn() }));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgentMock;
  },
}));

const db = await getTestDB();
const USER = 'im-user';
const OTHER = 'im-other';
const TOPIC = 'tpc_im';
const AGENT = 'agt_im';

const service = new ImRestService(db, USER);

const at = (iso: string) => new Date(iso);
/** `created_at` with microseconds — the precision Postgres stores and a JS Date drops. */
const atUs = (iso: string) => sql`${iso}::timestamptz`;

const insertMessage = (
  id: string,
  role: 'assistant' | 'user' | 'tool',
  content: string | null,
  createdAt: string,
  extra: Partial<typeof messages.$inferInsert> = {},
) =>
  db.insert(messages).values({
    content,
    createdAt: atUs(createdAt) as unknown as Date,
    id,
    role,
    topicId: TOPIC,
    updatedAt: atUs(createdAt) as unknown as Date,
    userId: USER,
    ...extra,
  });

const insertRun = (id: string, status: string, createdAt: string) =>
  db.insert(agentOperations).values({
    createdAt: atUs(createdAt) as unknown as Date,
    id,
    startedAt: at(createdAt),
    status: status as any,
    topicId: TOPIC,
    userId: USER,
  });

beforeEach(async () => {
  execAgentMock.mockReset();
  await db.delete(pushLiveActivities);
  await db.delete(pushTokens);
  await db.delete(agentOperations);
  await db.delete(messages);
  await db.delete(topics);
  await db.delete(workspaces);
  await db.delete(users);
  await db.insert(users).values([{ id: USER }, { id: OTHER }]);
  await db.insert(topics).values({ id: TOPIC, title: 'toby', userId: USER });
});

describe('ImRestService.sync — whole-message delivery', () => {
  it('withholds the reply (placeholder included) while the run is in flight, then delivers it whole', async () => {
    await insertMessage('msg_u1', 'user', 'hi', '2026-10-04T10:00:00.000100Z');
    await insertMessage('msg_a1', 'assistant', '...', '2026-10-04T10:00:00.000300Z');
    await insertRun('op_1', 'running', '2026-10-04T10:00:00.000500Z');

    const typing = await service.sync(TOPIC, {});
    expect(typing.typing).toBe(true);
    expect(typing.messages.map((m) => m.id)).toEqual(['msg_u1']);
    // The agent picked the message up: that is the read receipt.
    expect(typing.readUpTo?.messageId).toBe('msg_u1');
    expect(typing.unread).toBe(0);

    // The run writes its words and settles.
    await db.update(messages).set({ content: 'hey! what is up?' }).where(eq(messages.id, 'msg_a1'));
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, 'op_1'));

    const landed = await service.sync(TOPIC, { cursor: typing.cursor });
    expect(landed.typing).toBe(false);
    expect(landed.messages).toEqual([
      expect.objectContaining({ content: 'hey! what is up?', id: 'msg_a1', role: 'assistant' }),
    ]);
    expect(landed.unread).toBe(1);
  });

  it('treats a fresh placeholder with no run row yet as the run starting (queue-mode gap)', async () => {
    // execAgent wrote the user turn and the placeholder; the run row lands ~1s later.
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    await insertMessage('msg_u1', 'user', 'hi', iso(-200));
    await insertMessage('msg_a1', 'assistant', '...', iso(-190));

    const gap = await service.sync(TOPIC, {});
    expect(gap.typing).toBe(true);
    expect(gap.readUpTo?.messageId).toBe('msg_u1');
    expect(gap.messages.map((m) => m.id)).toEqual(['msg_u1']);

    // The run is recorded, writes its words and settles.
    await insertRun('op_1', 'running', iso(800));
    await db.update(messages).set({ content: 'hey there' }).where(eq(messages.id, 'msg_a1'));
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, 'op_1'));

    // The cursor from the gap must not have skipped the (then empty) placeholder.
    const landed = await service.sync(TOPIC, { cursor: gap.cursor });
    expect(landed.messages.map((m) => [m.id, m.content])).toEqual([['msg_a1', 'hey there']]);
  });

  it('keeps a parked waiting_for_client run typing, so its in-place reply is not lost', async () => {
    await insertMessage('msg_u1', 'user', 'hi', '2026-10-04T10:00:00.000100Z');
    // The run streamed a few words, then parked on a call the device client has
    // to make. That partial row is visible text, but it is not the reply yet.
    await insertMessage('msg_a1', 'assistant', 'half a tho', '2026-10-04T10:00:00.000300Z');
    await insertRun('op_1', 'waiting_for_client', '2026-10-04T10:00:00.000500Z');

    const parked = await service.sync(TOPIC, {});
    expect(parked.typing).toBe(true);
    expect(parked.messages.map((m) => m.id)).toEqual(['msg_u1']);

    // Resuming finishes the SAME row in place, so its created_at does not move:
    // a cursor parked past it would hide the finished reply forever.
    await db
      .update(messages)
      .set({ content: 'half a thought, finished' })
      .where(eq(messages.id, 'msg_a1'));
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, 'op_1'));

    const landed = await service.sync(TOPIC, { cursor: parked.cursor });
    expect(landed.messages.map((m) => [m.id, m.content])).toEqual([
      ['msg_a1', 'half a thought, finished'],
    ]);
  });

  it('keeps a microsecond cursor so a row in the same millisecond is neither repeated nor skipped', async () => {
    await insertMessage('msg_u1', 'user', 'one', '2026-10-04T10:00:00.000100Z');
    const first = await service.sync(TOPIC, {});
    expect(first.messages.map((m) => m.id)).toEqual(['msg_u1']);

    // Same millisecond, later microsecond — a JS Date cursor would collapse these.
    await insertMessage('msg_u2', 'user', 'two', '2026-10-04T10:00:00.000900Z');
    const second = await service.sync(TOPIC, { cursor: first.cursor });
    expect(second.messages.map((m) => m.id)).toEqual(['msg_u2']);

    const third = await service.sync(TOPIC, { cursor: second.cursor });
    expect(third.messages).toEqual([]);
  });

  it('reads a row that shares the cursor’s microsecond (id breaks the tie)', async () => {
    // One transaction stamps every row it writes with the same microsecond, so a
    // cursor carrying only the timestamp skips the rows tied with it.
    const sameMicrosecond = '2026-10-04T10:00:00.000100Z';
    await insertMessage('msg_u1', 'user', 'one', sameMicrosecond);
    const first = await service.sync(TOPIC, {});
    expect(first.messages.map((m) => m.id)).toEqual(['msg_u1']);

    await insertMessage('msg_u2', 'user', 'two', sameMicrosecond);
    const second = await service.sync(TOPIC, { cursor: first.cursor });
    expect(second.messages.map((m) => m.id)).toEqual(['msg_u2']);
  });

  it('does not move the cursor past a withheld reply when the user keeps typing', async () => {
    await insertMessage('msg_u1', 'user', 'first', '2026-10-04T10:00:01Z');
    await insertMessage('msg_a1', 'assistant', 'half a tho', '2026-10-04T10:00:02Z');
    await insertRun('op_1', 'running', '2026-10-04T10:00:01.5Z');
    await insertMessage('msg_u2', 'user', 'also…', '2026-10-04T10:00:03Z');

    const during = await service.sync(TOPIC, {});
    expect(during.messages.map((m) => m.id)).toEqual(['msg_u1', 'msg_u2']);

    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, 'op_1'));
    const after = await service.sync(TOPIC, { cursor: during.cursor });
    // The withheld reply is not lost; the user row past it is re-sent (deduped by id client-side).
    expect(after.messages.map((m) => m.id)).toEqual(['msg_a1', 'msg_u2']);
  });

  it('hides tool rows, tool-call-only steps and side threads; shows failed turns', async () => {
    await insertMessage('msg_u1', 'user', 'do it', '2026-10-04T10:00:01Z');
    await insertMessage('msg_a1', 'assistant', '', '2026-10-04T10:00:02Z');
    await insertMessage('msg_t1', 'tool', '{"ok":true}', '2026-10-04T10:00:03Z');
    await insertMessage('msg_a2', 'assistant', null, '2026-10-04T10:00:04Z', {
      error: { type: 'ProviderBizError' },
    });

    const result = await service.sync(TOPIC, {});
    expect(result.messages.map((m) => [m.id, m.error])).toEqual([
      ['msg_u1', false],
      ['msg_a2', true],
    ]);
  });

  it('applies the history limit to whole messages, not to hidden working rows', async () => {
    const base = Date.parse('2026-10-04T10:00:00Z');
    for (let i = 0; i < 5; i++) {
      await insertMessage(`msg_u${i}`, 'user', `m${i}`, new Date(base + i).toISOString());
    }
    // A tool-heavy turn leaves many invisible working rows at the top.
    for (let i = 0; i < 60; i++) {
      await insertMessage(`msg_h${i}`, 'assistant', '', new Date(base + 100 + i).toISOString());
    }

    const result = await service.sync(TOPIC, { limit: 5 });
    expect(result.messages.map((m) => m.id)).toEqual([
      'msg_u0',
      'msg_u1',
      'msg_u2',
      'msg_u3',
      'msg_u4',
    ]);
  });

  it('answers a long-poll as soon as the state changes', async () => {
    await insertMessage('msg_u1', 'user', 'hi', '2026-10-04T10:00:01Z');
    await insertRun('op_1', 'running', '2026-10-04T10:00:02Z');
    const before = await service.sync(TOPIC, {});

    setTimeout(() => {
      // Drizzle builders are lazy thenables: `.then` is what actually runs it.
      db.update(agentOperations)
        .set({ status: 'done' })
        .where(eq(agentOperations.id, 'op_1'))
        .then(() => {});
    }, 300);

    const started = Date.now();
    const changed = await service.sync(TOPIC, {
      cursor: before.cursor,
      state: before.state,
      waitMs: 10_000,
    });
    expect(changed.typing).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('keeps waiting while only already-delivered rows sit beyond the cursor', async () => {
    await insertMessage('msg_u1', 'user', 'first', '2026-10-04T10:00:01Z');
    await insertMessage('msg_a1', 'assistant', 'half a tho', '2026-10-04T10:00:02Z');
    await insertRun('op_1', 'running', '2026-10-04T10:00:01.5Z');
    await insertMessage('msg_u2', 'user', 'also…', '2026-10-04T10:00:03Z');

    const during = await service.sync(TOPIC, {});
    expect(during.messages.map((m) => m.id)).toEqual(['msg_u1', 'msg_u2']);

    // The user row past the withheld reply is re-sent, but that is not "news":
    // treating it as a change made every poll return at once (a tight loop).
    // 2000ms of waiting polls at most twice, and the loop always stops up to one
    // interval before the deadline — so ~1s is the whole wait, not an early return.
    const started = Date.now();
    const again = await service.sync(TOPIC, {
      cursor: during.cursor,
      state: during.state,
      waitMs: 2000,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(again.messages.map((m) => m.id)).toEqual(['msg_u2']);
    expect(again.state).toBe(during.state);
  });

  it('refuses another user’s conversation', async () => {
    await expect(new ImRestService(db, OTHER).sync(TOPIC, {})).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });
});

describe('ImRestService.markRead', () => {
  it('clears unread up to the message and never moves backwards', async () => {
    await insertMessage('msg_a1', 'assistant', 'one', '2026-10-04T10:00:00.000100Z');
    await insertMessage('msg_a2', 'assistant', 'two', '2026-10-04T10:00:00.000200Z');

    expect((await service.sync(TOPIC, {})).unread).toBe(2);
    expect(await service.markRead(TOPIC, { messageId: 'msg_a2' })).toEqual({ unread: 0 });
    // A stale device reporting an older message must not resurrect unread.
    expect(await service.markRead(TOPIC, { messageId: 'msg_a1' })).toEqual({ unread: 0 });

    const [topic] = await db.select().from(topics).where(eq(topics.id, TOPIC));
    expect(topic.metadata?.imReadCursors?.[USER]?.messageId).toBe('msg_a2');
  });

  it('counts every unread reply, not just the newest page, and ignores hidden rows', async () => {
    const base = Date.parse('2026-10-04T10:00:00Z');
    for (let i = 0; i < 120; i++) {
      await insertMessage(`msg_a${i}`, 'assistant', `reply ${i}`, new Date(base + i).toISOString());
    }
    // Working rows: empty placeholders and a tool step, none of them a bubble.
    for (let i = 0; i < 5; i++) {
      await insertMessage(`msg_h${i}`, 'assistant', '', new Date(base + 200 + i).toISOString());
    }

    expect((await service.sync(TOPIC, {})).unread).toBe(120);
    expect(await service.markRead(TOPIC, { messageId: 'msg_a119' })).toEqual({ unread: 0 });
  });

  it('keeps a cursor per viewer so one member’s read does not clear another’s', async () => {
    await db
      .insert(workspaces)
      .values({ id: 'ws_1', name: 'Team', primaryOwnerId: USER, slug: 'team' });
    await db
      .insert(topics)
      .values({ id: 'tpc_ws', title: 'shared', userId: USER, workspaceId: 'ws_1' });
    await db.insert(messages).values({
      content: 'hello team',
      createdAt: atUs('2026-10-04T10:00:00.000100Z') as unknown as Date,
      id: 'msg_ws_a1',
      role: 'assistant',
      topicId: 'tpc_ws',
      updatedAt: atUs('2026-10-04T10:00:00.000100Z') as unknown as Date,
      userId: USER,
      workspaceId: 'ws_1',
    });

    const mine = new ImRestService(db, USER, 'ws_1');
    const theirs = new ImRestService(db, OTHER, 'ws_1');

    expect((await theirs.sync('tpc_ws', {})).unread).toBe(1);
    expect(await mine.markRead('tpc_ws', { messageId: 'msg_ws_a1' })).toEqual({ unread: 0 });
    // The shared topic carries one cursor per member: mine is read, theirs is not.
    expect((await theirs.sync('tpc_ws', {})).unread).toBe(1);
  });

  it('refuses another user’s conversation', async () => {
    await insertMessage('msg_a1', 'assistant', 'one', '2026-10-04T10:00:00.000100Z');

    await expect(
      new ImRestService(db, OTHER).markRead(TOPIC, { messageId: 'msg_a1' }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    const [topic] = await db.select().from(topics).where(eq(topics.id, TOPIC));
    expect(topic.metadata?.imReadCursors).toBeUndefined();
  });

  it('refuses a message that belongs to a different conversation', async () => {
    await db.insert(topics).values({ id: 'tpc_second', title: 'second', userId: USER });
    await insertMessage('msg_elsewhere', 'assistant', 'hi', '2026-10-04T10:00:00.000100Z', {
      topicId: 'tpc_second',
    });

    await expect(service.markRead(TOPIC, { messageId: 'msg_elsewhere' })).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });
});

describe('ImRestService.send', () => {
  it('starts an interactive chat run and returns the stored user message', async () => {
    execAgentMock.mockImplementation(async () => {
      await insertMessage('msg_client0001', 'user', 'hello', '2026-10-04T10:00:01Z');
      return {
        operationId: 'op_1',
        success: true,
        topicId: TOPIC,
        userMessageId: 'msg_client0001',
      };
    });

    const result = await service.send({
      agentId: AGENT,
      clientMessageId: 'msg_client0001',
      content: 'hello',
      topicId: TOPIC,
    });

    expect(execAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT,
        appContext: { topicId: TOPIC },
        clientIds: { userMessageId: 'msg_client0001' },
        interactiveStart: true,
        prompt: 'hello',
        trigger: 'chat',
      }),
    );
    expect(result).toMatchObject({
      accepted: true,
      operationId: 'op_1',
      topicId: TOPIC,
      userMessage: { content: 'hello', id: 'msg_client0001', role: 'user' },
    });
  });

  it('is idempotent on clientMessageId: a retry does not start a second run', async () => {
    // What a send that got through leaves behind: the user row plus the reply
    // placeholder its run writes into. Only that pair is an accepted send.
    await insertMessage('msg_client0001', 'user', 'hello', '2026-10-04T10:00:01Z');
    await insertMessage('msg_client0001_reply', 'assistant', '...', '2026-10-04T10:00:01.5Z');

    const retry = await service.send({
      agentId: AGENT,
      clientMessageId: 'msg_client0001',
      content: 'hello',
      topicId: TOPIC,
    });

    expect(execAgentMock).not.toHaveBeenCalled();
    expect(retry).toMatchObject({ accepted: false, operationId: null, topicId: TOPIC });
  });

  it('reports the winning receipt when a concurrent first send collides on the id', async () => {
    // Both sends miss the pre-check; the loser is told the message was received
    // already — including when the collision surfaces as a thrown error.
    execAgentMock.mockImplementation(async () => {
      await insertMessage('msg_client0001', 'user', 'hello', '2026-10-04T10:00:01Z');
      await insertMessage('msg_client0001_reply', 'assistant', '...', '2026-10-04T10:00:01.5Z');
      return { error: 'duplicate key value violates unique constraint', success: false };
    });

    const lost = await service.send({
      agentId: AGENT,
      clientMessageId: 'msg_client0001',
      content: 'hello',
      topicId: TOPIC,
    });
    expect(lost).toMatchObject({
      accepted: false,
      operationId: null,
      userMessage: { id: 'msg_client0001' },
    });

    execAgentMock.mockImplementation(async () => {
      await insertMessage('msg_client0002', 'user', 'hello again', '2026-10-04T10:00:02Z');
      await insertMessage('msg_client0002_reply', 'assistant', '...', '2026-10-04T10:00:02.5Z');
      throw new Error('duplicate key value violates unique constraint');
    });

    const threw = await service.send({
      agentId: AGENT,
      clientMessageId: 'msg_client0002',
      content: 'hello again',
      topicId: TOPIC,
    });
    expect(threw).toMatchObject({ accepted: false, userMessage: { id: 'msg_client0002' } });
  });

  it('does not report a receipt for a send that stored the message but never started a turn', async () => {
    // execAgent stores the user row before the placeholder and the operation, so a
    // failure in between leaves the row behind with nothing to wait for.
    execAgentMock.mockImplementation(async () => {
      await insertMessage('msg_client_failed', 'user', 'hello', '2026-10-04T10:00:03Z');
      throw new Error('operation creation failed');
    });

    await expect(
      service.send({
        agentId: AGENT,
        clientMessageId: 'msg_client_failed',
        content: 'hello',
        topicId: TOPIC,
      }),
    ).rejects.toThrow('operation creation failed');

    // A retry must not answer "already received" for a message no run picked up.
    execAgentMock.mockResolvedValue({ error: 'id taken', success: false });
    await expect(
      service.send({
        agentId: AGENT,
        clientMessageId: 'msg_client_failed',
        content: 'hello',
        topicId: TOPIC,
      }),
    ).rejects.toMatchObject({ name: 'BusinessError' });
    expect(execAgentMock).toHaveBeenCalledTimes(2);
  });

  it('refuses to post into another user’s conversation without starting a run', async () => {
    await expect(
      new ImRestService(db, OTHER).send({ agentId: AGENT, content: 'hi', topicId: TOPIC }),
    ).rejects.toMatchObject({ name: 'AuthorizationError' });
    expect(execAgentMock).not.toHaveBeenCalled();
  });

  it('does not treat another user’s message id as an idempotent retry', async () => {
    await insertMessage('msg_client0001', 'user', 'hello', '2026-10-04T10:00:01Z');
    await db.insert(topics).values({ id: 'tpc_other', title: 'other', userId: OTHER });
    execAgentMock.mockResolvedValue({ error: 'id taken', success: false });

    await expect(
      new ImRestService(db, OTHER).send({
        agentId: AGENT,
        clientMessageId: 'msg_client0001',
        content: 'hello',
        topicId: 'tpc_other',
      }),
    ).rejects.toMatchObject({ name: 'BusinessError' });
    // The lookup is owner-scoped, so the run is attempted (and the id clash
    // surfaces there) instead of leaking the first user's message back.
    expect(execAgentMock).toHaveBeenCalledTimes(1);
  });
});

describe('ImRestService push tokens', () => {
  it('registers, rotates and unregisters a device', async () => {
    await service.registerPushToken('device-1', {
      expoToken: 'ExponentPushToken[aaa]',
      platform: 'ios',
    });
    await service.registerPushToken('device-1', {
      expoToken: 'ExponentPushToken[bbb]',
      platform: 'ios',
    });
    let rows = await db.select().from(pushTokens).where(eq(pushTokens.userId, USER));
    expect(rows.map((row) => row.expoToken)).toEqual(['ExponentPushToken[bbb]']);

    await service.unregisterPushToken('device-1');
    rows = await db.select().from(pushTokens).where(eq(pushTokens.userId, USER));
    expect(rows).toEqual([]);
  });

  it('never deletes another user’s device, even with its exact token', async () => {
    await service.registerPushToken('device-1', {
      expoToken: 'ExponentPushToken[aaa]',
      platform: 'ios',
    });

    const other = new ImRestService(db, OTHER);
    await other.unregisterPushToken('device-1', 'ExponentPushToken[aaa]');
    await other.unregisterPushToken('device-1');

    const rows = await db.select().from(pushTokens).where(eq(pushTokens.userId, USER));
    expect(rows.map((row) => row.expoToken)).toEqual(['ExponentPushToken[aaa]']);
  });

  it('refuses a workspace-scoped credential, which would fan out beyond its workspace', async () => {
    const scoped = new ImRestService(db, USER, 'ws_1');

    await expect(
      scoped.registerPushToken('device-1', {
        expoToken: 'ExponentPushToken[aaa]',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ name: 'AuthorizationError' });
    await expect(scoped.unregisterPushToken('device-1')).rejects.toMatchObject({
      name: 'AuthorizationError',
    });

    expect(await db.select().from(pushTokens)).toEqual([]);
  });

  it('keeps a rotated token when a stale sign-out names the old one', async () => {
    await service.registerPushToken('device-1', {
      expoToken: 'ExponentPushToken[bbb]',
      platform: 'ios',
    });

    await service.unregisterPushToken('device-1', 'ExponentPushToken[aaa]');
    let rows = await db.select().from(pushTokens).where(eq(pushTokens.userId, USER));
    expect(rows).toHaveLength(1);

    await service.unregisterPushToken('device-1', 'ExponentPushToken[bbb]');
    rows = await db.select().from(pushTokens).where(eq(pushTokens.userId, USER));
    expect(rows).toEqual([]);
  });

  it('leaves the Live Activity tokens alone when a stale sign-out retires nothing', async () => {
    await service.registerPushToken('device-1', {
      expoToken: 'ExponentPushToken[bbb]',
      platform: 'ios',
    });
    await db.insert(pushLiveActivities).values({
      activityId: 'activity-1',
      activityKey: 'key-1',
      apnsEnvironment: 'production',
      deviceId: 'device-1',
      operationId: 'op-1',
      pushToken: 'ExponentPushToken[bbb]',
      userId: USER,
    });

    // A sign-out naming a token the device already rotated retires nothing, so
    // the newer registration and the activities it feeds must survive.
    await service.unregisterPushToken('device-1', 'ExponentPushToken[aaa]');
    expect(await db.select().from(pushTokens)).toHaveLength(1);
    expect(await db.select().from(pushLiveActivities)).toHaveLength(1);

    // An explicit sign-out still takes both.
    await service.unregisterPushToken('device-1');
    expect(await db.select().from(pushTokens)).toEqual([]);
    expect(await db.select().from(pushLiveActivities)).toEqual([]);
  });
});
