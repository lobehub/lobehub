// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agentOperations, messages, pushTokens, topics, users } from '@/database/schemas';

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
  await db.delete(pushTokens);
  await db.delete(agentOperations);
  await db.delete(messages);
  await db.delete(topics);
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
    expect(topic.metadata?.imReadCursor?.messageId).toBe('msg_a2');
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
    await insertMessage('msg_client0001', 'user', 'hello', '2026-10-04T10:00:01Z');

    const retry = await service.send({
      agentId: AGENT,
      clientMessageId: 'msg_client0001',
      content: 'hello',
      topicId: TOPIC,
    });

    expect(execAgentMock).not.toHaveBeenCalled();
    expect(retry).toMatchObject({ accepted: false, operationId: null, topicId: TOPIC });
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
});
