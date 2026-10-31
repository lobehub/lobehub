// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  agentOperations,
  agents,
  chatGroups,
  chatGroupsAgents,
  files,
  messages,
  messagesFiles,
  pushLiveActivities,
  pushTokens,
  topics,
  users,
  workspaces,
} from '@/database/schemas';
import { ForeignLiveRunError } from '@/server/services/aiAgent/topicStartReservation';

import { ImSendRequestSchema } from '../../types/im.type';
import { ImRestService } from '../im.service';

const { execAgentMock, execGroupAgentMock } = vi.hoisted(() => ({
  execAgentMock: vi.fn(),
  execGroupAgentMock: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgentMock;
    execGroupAgent = execGroupAgentMock;
  },
}));

const db = await getTestDB();
const USER = 'im-user';
const OTHER = 'im-other';
const TOPIC = 'tpc_im';
const AGENT = 'agt_im';
const GROUP = 'grp_im';
const SUPERVISOR = 'agt_im_supervisor';
const MEMBER = 'agt_im_member';
const GROUP_TOPIC = 'tpc_im_group';

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

const insertGroup = async ({ supervisor = true }: { supervisor?: boolean } = {}) => {
  await db.insert(agents).values([
    { id: SUPERVISOR, userId: USER, virtual: true },
    { id: MEMBER, userId: USER },
    { id: AGENT, userId: USER },
  ]);
  await db.insert(chatGroups).values({ id: GROUP, title: 'crew', userId: USER });
  await db
    .insert(chatGroupsAgents)
    .values([
      ...(supervisor
        ? [{ agentId: SUPERVISOR, chatGroupId: GROUP, role: 'supervisor', userId: USER }]
        : []),
      { agentId: MEMBER, chatGroupId: GROUP, role: 'participant', userId: USER },
    ]);
  await db
    .insert(topics)
    .values({ groupId: GROUP, id: GROUP_TOPIC, title: 'crew chat', userId: USER });
};

beforeEach(async () => {
  execAgentMock.mockReset();
  execGroupAgentMock.mockReset();
  await db.delete(pushLiveActivities);
  await db.delete(pushTokens);
  await db.delete(agentOperations);
  await db.delete(messages);
  await db.delete(files);
  await db.delete(topics);
  await db.delete(chatGroupsAgents);
  await db.delete(chatGroups);
  await db.delete(agents);
  await db.delete(workspaces);
  await db.delete(users);
  await db.insert(users).values([{ id: USER }, { id: OTHER }]);
  await db.insert(topics).values({ id: TOPIC, title: 'toby', userId: USER });
});

describe('ImRestService.sync — whole-message delivery', () => {
  it('delivers and counts an attachment-only assistant reply and allows marking it read', async () => {
    await db.insert(files).values({
      id: 'file_reply',
      userId: USER,
      name: 'reply.png',
      fileType: 'image/png',
      size: 123,
      url: 'https://example.com/reply.png',
    });
    await insertMessage('msg_file_reply', 'assistant', '', '2026-10-04T10:00:00Z');
    await db
      .insert(messagesFiles)
      .values({ fileId: 'file_reply', messageId: 'msg_file_reply', userId: USER });
    const result = await service.sync(TOPIC, {});
    expect(result.messages[0]).toMatchObject({ content: '', files: [{ id: 'file_reply' }] });
    expect(result.unread).toBe(1);
    await expect(service.markRead(TOPIC, { messageId: 'msg_file_reply' })).resolves.toEqual({
      unread: 0,
    });
  });
  it('returns attachment metadata with an attachment-only user message', async () => {
    await db.insert(files).values({
      id: 'file_tea',
      userId: USER,
      name: 'tea.png',
      fileType: 'image/png',
      size: 123,
      url: 'https://example.com/tea.png',
    });
    await insertMessage('msg_photo', 'user', '', '2026-10-04T10:00:00Z');
    await db
      .insert(messagesFiles)
      .values({ fileId: 'file_tea', messageId: 'msg_photo', userId: USER });

    const result = await service.sync(TOPIC, {});
    expect(result.messages[0]).toMatchObject({
      content: '',
      files: [
        {
          id: 'file_tea',
          name: 'tea.png',
          fileType: 'image/png',
          size: 123,
          url: 'https://example.com/tea.png',
        },
      ],
    });
  });

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

  it('carries the writing agent on each message and withholds the whole group turn', async () => {
    await insertGroup();
    const inGroup = { groupId: GROUP, topicId: GROUP_TOPIC };
    await insertMessage('msg_u1', 'user', 'plan the trip', '2026-10-04T10:00:00.000100Z', {
      ...inGroup,
      agentId: SUPERVISOR,
    });
    await insertMessage('msg_sup', 'assistant', 'asking the crew', '2026-10-04T10:00:00.000300Z', {
      ...inGroup,
      agentId: SUPERVISOR,
    });
    await insertMessage('msg_mem', 'assistant', 'flights are boo', '2026-10-04T10:00:00.000400Z', {
      ...inGroup,
      agentId: MEMBER,
    });
    // The supervisor parks on the member call; the member runs as its child.
    await db.insert(agentOperations).values([
      {
        createdAt: atUs('2026-10-04T10:00:00.000200Z') as unknown as Date,
        id: 'op_sup',
        status: 'waiting_for_async_tool',
        topicId: GROUP_TOPIC,
        userId: USER,
      },
      {
        createdAt: atUs('2026-10-04T10:00:00.000350Z') as unknown as Date,
        id: 'op_mem',
        parentOperationId: 'op_sup',
        status: 'running',
        topicId: GROUP_TOPIC,
        userId: USER,
      },
    ]);

    const working = await service.sync(GROUP_TOPIC, {});
    expect(working.typing).toBe(true);
    expect(working.readUpTo?.messageId).toBe('msg_u1');
    expect(working.messages).toEqual([
      expect.objectContaining({ agentId: null, id: 'msg_u1', role: 'user' }),
    ]);

    await db
      .update(messages)
      .set({ content: 'flights are booked' })
      .where(eq(messages.id, 'msg_mem'));
    await db.update(agentOperations).set({ status: 'done' });

    const landed = await service.sync(GROUP_TOPIC, { cursor: working.cursor });
    expect(landed.typing).toBe(false);
    expect(landed.messages.map((m) => [m.id, m.agentId, m.content])).toEqual([
      ['msg_sup', SUPERVISOR, 'asking the crew'],
      ['msg_mem', MEMBER, 'flights are booked'],
    ]);
    expect(landed.unread).toBe(2);
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

  it('refuses a read target that is not a delivered agent reply', async () => {
    await insertMessage('msg_u1', 'user', 'did it ship?', '2026-10-04T10:00:00.000100Z');
    await insertMessage('msg_a1', 'assistant', 'shipped', '2026-10-04T10:00:00.000200Z');
    // A working row: the placeholder a run is still writing into.
    await insertMessage('msg_writing', 'assistant', '...', '2026-10-04T10:00:00.000300Z');

    await expect(service.markRead(TOPIC, { messageId: 'msg_u1' })).rejects.toMatchObject({
      name: 'ValidationError',
    });
    await expect(service.markRead(TOPIC, { messageId: 'msg_writing' })).rejects.toMatchObject({
      name: 'ValidationError',
    });

    // Neither attempt moved the cursor, so the delivered reply is still unread.
    expect((await service.sync(TOPIC, {})).unread).toBe(1);
    const [topic] = await db.select().from(topics).where(eq(topics.id, TOPIC));
    expect(topic.metadata?.imReadCursors).toBeUndefined();
  });

  it('keeps unread after the read cursor’s own message is deleted', async () => {
    await insertMessage('msg_a1', 'assistant', 'one', '2026-10-04T10:00:00.000100Z');
    await insertMessage('msg_a2', 'assistant', 'two', '2026-10-04T10:00:00.000200Z');

    expect(await service.markRead(TOPIC, { messageId: 'msg_a1' })).toEqual({ unread: 1 });
    // The user deletes the reply they had read: the cursor has to keep ordering the
    // replies after it instead of comparing every one of them against NULL.
    await db.delete(messages).where(eq(messages.id, 'msg_a1'));

    expect((await service.sync(TOPIC, {})).unread).toBe(1);
    expect(await service.markRead(TOPIC, { messageId: 'msg_a2' })).toEqual({ unread: 0 });
  });

  it('does not read a reply that only shares the cursor’s microsecond', async () => {
    // One transaction stamps every row it writes with the same microsecond.
    await insertMessage('msg_same_1', 'assistant', 'one', '2026-10-04T10:00:00.000100Z');
    await insertMessage('msg_same_2', 'assistant', 'two', '2026-10-04T10:00:00.000100Z');

    expect((await service.sync(TOPIC, {})).unread).toBe(2);
    // The id breaks the tie: only the row the cursor names becomes read.
    expect(await service.markRead(TOPIC, { messageId: 'msg_same_1' })).toEqual({ unread: 1 });
    expect(await service.markRead(TOPIC, { messageId: 'msg_same_2' })).toEqual({ unread: 0 });
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
    expect(execGroupAgentMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      accepted: true,
      operationId: 'op_1',
      topicId: TOPIC,
      userMessage: { agentId: null, content: 'hello', id: 'msg_client0001', role: 'user' },
    });
  });

  it('requires an agentId or a groupId', () => {
    expect(ImSendRequestSchema.safeParse({ content: 'hi' }).success).toBe(false);
    expect(ImSendRequestSchema.safeParse({ agentId: AGENT, content: 'hi' }).success).toBe(true);
    expect(ImSendRequestSchema.safeParse({ content: 'hi', groupId: GROUP }).success).toBe(true);
  });

  it('accepts attachment-only messages but rejects an empty turn', () => {
    expect(
      ImSendRequestSchema.safeParse({ agentId: AGENT, content: '', fileIds: ['file_tea'] }).success,
    ).toBe(true);
    expect(
      ImSendRequestSchema.safeParse({ agentId: AGENT, content: '  ', fileIds: [] }).success,
    ).toBe(false);
    expect(
      ImSendRequestSchema.safeParse({ agentId: AGENT, content: '', fileIds: [''] }).success,
    ).toBe(false);
  });

  it('rejects missing or inaccessible files before starting an agent', async () => {
    await db.insert(files).values({
      id: 'file_other',
      userId: OTHER,
      name: 'private.png',
      fileType: 'image/png',
      size: 123,
      url: 'https://example.com/private.png',
    });
    for (const fileId of ['file_missing', 'file_other']) {
      await expect(
        service.send({ agentId: AGENT, content: 'look', fileIds: [fileId] }),
      ).rejects.toThrow();
    }
    expect(execAgentMock).not.toHaveBeenCalled();
  });

  it('attaches uploaded files to an agent turn and retains them in an idempotent receipt', async () => {
    await db.insert(files).values({
      id: 'file_tea',
      userId: USER,
      name: 'tea.png',
      fileType: 'image/png',
      size: 123,
      url: 'https://example.com/tea.png',
    });
    execAgentMock.mockImplementation(async (input) => {
      await insertMessage('msg_file00001', 'user', input.prompt, '2026-10-04T10:00:00Z');
      await insertMessage('msg_file_reply', 'assistant', '...', '2026-10-04T10:00:01Z');
      for (const fileId of input.fileIds ?? []) {
        await db.insert(messagesFiles).values({ fileId, messageId: 'msg_file00001', userId: USER });
      }
      return {
        success: true,
        operationId: 'op_file',
        topicId: TOPIC,
        userMessageId: 'msg_file00001',
      };
    });
    const input = {
      agentId: AGENT,
      content: '',
      fileIds: ['file_tea'],
      clientMessageId: 'msg_file00001',
    };
    const sent = await service.send(input);
    const retried = await service.send(input);
    expect(sent.userMessage.files?.map((file) => file.id)).toEqual(['file_tea']);
    expect(retried.userMessage.files).toEqual(sent.userMessage.files);
    expect(retried.accepted).toBe(false);
    expect(execAgentMock).toHaveBeenCalledTimes(1);
  });

  it('runs a group send through the group supervisor in a new group topic', async () => {
    await insertGroup();
    execGroupAgentMock.mockImplementation(async () => {
      await insertMessage('msg_client0003', 'user', 'plan it', '2026-10-04T10:00:01Z', {
        agentId: SUPERVISOR,
        groupId: GROUP,
        topicId: GROUP_TOPIC,
      });
      return {
        isCreateNewTopic: true,
        operationId: 'op_group',
        success: true,
        topicId: GROUP_TOPIC,
        userMessageId: 'msg_client0003',
      };
    });

    const result = await service.send({
      clientMessageId: 'msg_client0003',
      content: 'plan it',
      groupId: GROUP,
    });

    expect(execAgentMock).not.toHaveBeenCalled();
    expect(execGroupAgentMock).toHaveBeenCalledWith({
      agentId: SUPERVISOR,
      clientIds: { userMessageId: 'msg_client0003' },
      groupId: GROUP,
      interactiveStart: true,
      message: 'plan it',
      topicId: undefined,
    });
    expect(result).toEqual({
      accepted: true,
      operationId: 'op_group',
      topicId: GROUP_TOPIC,
      userMessage: expect.objectContaining({ agentId: null, id: 'msg_client0003', role: 'user' }),
    });

    // A retry of the same group send is answered from the stored turn.
    await insertMessage('msg_client0003_reply', 'assistant', '...', '2026-10-04T10:00:01.5Z', {
      agentId: SUPERVISOR,
      topicId: GROUP_TOPIC,
    });
    const retry = await service.send({
      clientMessageId: 'msg_client0003',
      content: 'plan it',
      groupId: GROUP,
    });
    expect(retry).toMatchObject({ accepted: false, operationId: null, topicId: GROUP_TOPIC });
    expect(execGroupAgentMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a member agentId with the group and still runs the supervisor', async () => {
    await insertGroup();
    execGroupAgentMock.mockImplementation(async () => {
      await insertMessage('msg_client0004', 'user', 'hey crew', '2026-10-04T10:00:01Z', {
        topicId: GROUP_TOPIC,
      });
      return {
        operationId: 'op_g',
        success: true,
        topicId: GROUP_TOPIC,
        userMessageId: 'msg_client0004',
      };
    });

    await service.send({
      agentId: MEMBER,
      clientMessageId: 'msg_client0004',
      content: 'hey crew',
      groupId: GROUP,
      topicId: GROUP_TOPIC,
    });

    expect(execGroupAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: SUPERVISOR, groupId: GROUP, topicId: GROUP_TOPIC }),
    );
  });

  it("answers a conflict when another member's run drives the conversation", async () => {
    execAgentMock.mockRejectedValue(new ForeignLiveRunError('topic busy'));

    await expect(
      service.send({ agentId: AGENT, content: 'keep going', topicId: TOPIC }),
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('refuses an agentId that is not a member of the group', async () => {
    await insertGroup();

    await expect(
      service.send({ agentId: AGENT, content: 'hi', groupId: GROUP }),
    ).rejects.toMatchObject({
      message: 'agentId is not a member of this group',
      name: 'ConflictError',
    });
    expect(execGroupAgentMock).not.toHaveBeenCalled();
    expect(execAgentMock).not.toHaveBeenCalled();
  });

  it('refuses a group with no supervisor instead of picking a member', async () => {
    await insertGroup({ supervisor: false });

    await expect(service.send({ content: 'hi', groupId: GROUP })).rejects.toMatchObject({
      name: 'ConflictError',
    });
    expect(execGroupAgentMock).not.toHaveBeenCalled();
  });

  it('refuses a conversation that belongs to another group or to a 1:1 chat', async () => {
    await insertGroup();

    await expect(
      service.send({ content: 'hi', groupId: GROUP, topicId: TOPIC }),
    ).rejects.toMatchObject({ name: 'ConflictError' });
    expect(execGroupAgentMock).not.toHaveBeenCalled();
  });

  it('refuses a group the caller cannot see', async () => {
    await insertGroup();

    await expect(
      new ImRestService(db, OTHER).send({ content: 'hi', groupId: GROUP }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(execGroupAgentMock).not.toHaveBeenCalled();
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
