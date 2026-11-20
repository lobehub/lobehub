// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { artboardComments, tasks, users, workspaceMembers, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ArtboardCommentError, ArtboardCommentModel } from '../comment';
import { ArtboardModel } from '../index';
import { ArtboardStructureModel } from '../structure';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'artboard-comment-user';
const otherUserId = 'artboard-comment-other';
const workspaceId = 'artboard-comment-ws';
const taskId = 'task_abc_ws';

const artboards = new ArtboardModel(serverDB, userId, workspaceId);
const structure = new ArtboardStructureModel(serverDB, userId, workspaceId);
const comments = new ArtboardCommentModel(serverDB, userId, workspaceId);
const member = new ArtboardCommentModel(serverDB, otherUserId, workspaceId);

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId });
  await serverDB.insert(workspaceMembers).values([
    { userId, workspaceId },
    { userId: otherUserId, workspaceId },
  ]);
  await serverDB.insert(tasks).values({
    createdByUserId: userId,
    id: taskId,
    identifier: 'C-1',
    instruction: 'design onboarding',
    seq: 1,
    visibility: 'public',
    workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(tasks).where(eq(tasks.id, taskId));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await cleanup();
});

const seed = async () => {
  const artboard = await artboards.create({ taskId, title: '登录流程' });
  const [page] = (await structure.getStructure(artboard.id))!.pages;
  const group = await structure.createGroup(artboard.id, {
    kind: 'journey',
    pageId: page.id,
    rect: { h: 600, w: 1500, x: 0, y: 0 },
    title: '主流程',
  });
  const board = await structure.createBoard(artboard.id, {
    groupId: group.id,
    pageId: page.id,
    rect: { h: 400, w: 640, x: 48, y: 144 },
    title: '登录页',
    type: 'html',
  });
  return { artboard, board, group, page };
};

const expectCode = async (run: Promise<unknown>, code: string) => {
  await expect(run).rejects.toBeInstanceOf(ArtboardCommentError);
  await expect(run).rejects.toMatchObject({ code });
};

describe('ArtboardCommentModel', () => {
  it('stores where a comment was made on a board', async () => {
    const { artboard, board, page } = await seed();

    const comment = await comments.create(artboard.id, {
      anchor: { nodePath: 'body > main > button', offsetX: 0.5, offsetY: 0.25, type: 'node' },
      boardId: board.id,
      clientId: 'c1',
      content: '按钮太小',
      pageId: page.id,
    });

    expect(comment.id).toMatch(/^[\da-f-]{36}$/);
    expect(comment).toMatchObject({
      anchor: { nodePath: 'body > main > button', type: 'node' },
      authorAgentId: null,
      authorUserId: userId,
      boardId: board.id,
      deliveredAt: null,
      parentCommentId: null,
      resolvedAt: null,
    });
  });

  it('writes one row when the same create is retried', async () => {
    const { artboard, page } = await seed();
    const input = { clientId: 'retry', content: '这里留白太多', pageId: page.id };

    const first = await comments.create(artboard.id, input);
    const second = await comments.create(artboard.id, input);

    expect(second.id).toBe(first.id);
    expect(
      await serverDB
        .select()
        .from(artboardComments)
        .where(eq(artboardComments.artboardId, artboard.id)),
    ).toHaveLength(1);
  });

  it('threads replies under the root, including a reply to a reply', async () => {
    const { artboard, page } = await seed();
    const root = await comments.create(artboard.id, {
      clientId: 'root',
      content: '要不要第三方登录？',
      pageId: page.id,
    });

    const reply = await member.reply(root.id, { clientId: 'r1', content: '要，先接 Google' });
    const nested = await comments.reply(reply.id, { clientId: 'r2', content: '好' });

    expect(nested.parentCommentId).toBe(root.id);
    const [thread] = await comments.listThreads(artboard.id);
    expect(thread.root.id).toBe(root.id);
    expect(thread.replies.map((item) => item.content)).toEqual(['要，先接 Google', '好']);
    expect(thread.replies[0].authorUserId).toBe(otherUserId);
  });

  it('resolves and reopens a thread, and only a root can be resolved', async () => {
    const { artboard, page } = await seed();
    const root = await comments.create(artboard.id, {
      clientId: 'root',
      content: '文案待定',
      pageId: page.id,
    });
    const reply = await comments.reply(root.id, { clientId: 'r1', content: '已改' });

    const resolved = await comments.resolve(root.id);
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.resolvedByUserId).toBe(userId);
    expect(await comments.listThreads(artboard.id, { unresolvedOnly: true })).toEqual([]);
    expect(await comments.listThreads(artboard.id)).toHaveLength(1);

    const reopened = await comments.reopen(root.id);
    expect(reopened).toMatchObject({ resolvedAt: null, resolvedByUserId: null });
    await expectCode(comments.resolve(reply.id), 'invalid');
  });

  it('keeps a comment when its board is deleted', async () => {
    const { artboard, board, page } = await seed();
    const comment = await comments.create(artboard.id, {
      boardId: board.id,
      clientId: 'c1',
      content: '这张不要了',
      pageId: page.id,
    });

    await structure.deleteBoard(board.id);

    const [thread] = await comments.listThreads(artboard.id);
    expect(thread.root).toMatchObject({ boardId: null, content: '这张不要了', id: comment.id });
  });

  it('hands the agent only unresolved threads with an undelivered message', async () => {
    const { artboard, page } = await seed();
    const add = (clientId: string) =>
      comments.create(artboard.id, { clientId, content: clientId, pageId: page.id });
    const seen = await add('seen');
    const answered = await add('answered');
    const fresh = await add('fresh');
    const done = await add('done');
    await comments.resolve(done.id);

    expect((await comments.listUndelivered(artboard.id)).map((t) => t.root.id)).toEqual([
      seen.id,
      answered.id,
      fresh.id,
    ]);

    await comments.markDelivered([seen.id, answered.id], new Date('2026-11-10T09:00:00Z'));
    await comments.reply(answered.id, { clientId: 'again', content: '还有一点' });

    expect((await comments.listUndelivered(artboard.id)).map((t) => t.root.id)).toEqual([
      answered.id,
      fresh.id,
    ]);
  });

  it('keeps the first delivery time and ignores comments the caller cannot reach', async () => {
    const { artboard, page } = await seed();
    const root = await comments.create(artboard.id, {
      clientId: 'root',
      content: '先看这个',
      pageId: page.id,
    });
    const first = new Date('2026-11-10T09:00:00Z');
    await comments.markDelivered([root.id], first);
    await comments.markDelivered([root.id], new Date('2026-11-10T10:00:00Z'));
    await serverDB.update(tasks).set({ visibility: 'private' }).where(eq(tasks.id, taskId));
    const fresh = await comments.create(artboard.id, {
      clientId: 'fresh',
      content: '新的',
      pageId: page.id,
    });

    await member.markDelivered([fresh.id], new Date());

    const [thread, other] = await comments.listThreads(artboard.id);
    expect(thread.root.deliveredAt).toEqual(first);
    expect(other.root.deliveredAt).toBeNull();
  });

  it('refuses an anchor that belongs to another artboard', async () => {
    const { board } = await seed();
    await serverDB.insert(tasks).values({
      createdByUserId: userId,
      id: 'task_abc_2',
      identifier: 'C-2',
      instruction: 'another',
      seq: 2,
      visibility: 'public',
      workspaceId,
    });
    const other = await artboards.create({ taskId: 'task_abc_2', title: '另一块' });

    await expectCode(
      comments.create(other.id, { boardId: board.id, clientId: 'x', content: '串门' }),
      'not_found',
    );
  });

  it('keeps every row when a contributing member account is deleted', async () => {
    const { artboard, group, page } = await seed();
    const memberStructure = new ArtboardStructureModel(serverDB, otherUserId, workspaceId);
    const size = {
      pageId: page.id,
      rect: { h: 400, w: 640, x: 0, y: 0 },
      type: 'html' as const,
    };
    const memberGroup = await memberStructure.createGroup(artboard.id, {
      kind: 'references',
      pageId: page.id,
      rect: { h: 600, w: 800, x: 1600, y: 0 },
      title: '参考',
    });
    await structure.createBoard(artboard.id, { ...size, groupId: memberGroup.id, title: '竞品' });
    await memberStructure.createBoard(artboard.id, { ...size, groupId: group.id, title: '注册页' });
    await member.create(artboard.id, { clientId: 'm1', content: '成员的评论', pageId: page.id });

    await serverDB.delete(users).where(eq(users.id, otherUserId));

    const read = await structure.getStructure(artboard.id);
    expect(read?.groups).toHaveLength(2);
    expect(read?.boards.map((item) => item.userId)).toEqual([userId, userId, userId]);
    const [thread] = await comments.listThreads(artboard.id);
    expect(thread.root).toMatchObject({ authorUserId: null, content: '成员的评论', userId });
  });

  it('follows the parent task: a private task hides its comments from other members', async () => {
    const { artboard, page } = await seed();
    const root = await comments.create(artboard.id, {
      clientId: 'root',
      content: '私下说',
      pageId: page.id,
    });
    await serverDB.update(tasks).set({ visibility: 'private' }).where(eq(tasks.id, taskId));

    expect(await member.listThreads(artboard.id)).toEqual([]);
    expect(await member.listUndelivered(artboard.id)).toEqual([]);
    await expectCode(
      member.create(artboard.id, { clientId: 'm1', content: '偷看', pageId: page.id }),
      'not_found',
    );
    await expectCode(member.reply(root.id, { clientId: 'm2', content: '插话' }), 'not_found');
    await expectCode(member.resolve(root.id), 'not_found');
    expect((await comments.listThreads(artboard.id))[0].replies).toEqual([]);
  });
});
