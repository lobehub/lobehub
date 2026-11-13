// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import type { ArtboardOp } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkModel } from '@/database/models/work';
import { agents, projects, tasks, topics, users } from '@/database/schemas';

import { ArtboardServiceError } from '../errors';
import { ArtboardService } from '../index';
import { type ArtboardSourceResolver, createArtboardSourceResolver } from '../sources';

const userId = 'artboard-comments-user';
const agentId = 'agt_artboard_comments';
const projectId = 'prj_artboard_comments';
const topicId = 'tpc_artboard_comments';

const db: LobeChatDatabase = await getTestDB();

const sources: ArtboardSourceResolver = createArtboardSourceResolver(db, { userId });

const asUser = () =>
  new ArtboardService(db, userId, undefined, { context: { agentId: null }, sources });
const asAgent = () => new ArtboardService(db, userId, undefined, { context: { agentId }, sources });

const registerCanvas = (canvasId: string) =>
  new WorkModel(db, userId).registerCanvas({
    canvasId,
    metadata: {
      entry: 'index.html',
      fileCount: 1,
      manifestKey: `canvas/${canvasId}/${Date.now()}-${Math.random()}.json`,
      runtimeMajor: 1,
      totalSize: 1,
    },
    title: canvasId,
    toolIdentifier: 'lobe-canvas',
    toolName: 'createCanvas',
  });

const ops = (): ArtboardOp[] => [
  { group: { kind: 'journey', title: '主流程' }, ref: 'j', type: 'addGroup' },
  {
    board: {
      groupId: 'j',
      source: { canvasId: 'cvs_c1', kind: 'canvas' },
      title: '首页',
      x: 0,
      y: 0,
    },
    type: 'addBoard',
  },
  { ref: 'r', round: { title: '入口放哪' }, type: 'addRound' },
  { group: { kind: 'options', title: '方案' }, ref: 'o', type: 'addGroup' },
  {
    board: {
      groupId: 'o',
      recommended: true,
      roundId: 'r',
      source: { canvasId: 'cvs_c2', kind: 'canvas' },
      title: 'A',
      x: 0,
      y: 800,
    },
    type: 'addBoard',
  },
];

const create = async () => {
  const { artboard } = await asUser().create({ ops: ops(), title: '画板' }, { topicId });
  const journey = artboard.content.boards.find((b) => !b.roundId)!;
  const option = artboard.content.boards.find((b) => b.roundId)!;
  return { artboard, journey, option, round: artboard.content.rounds[0] };
};

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtboardServiceError) return error;
    throw error;
  }
  throw new Error('expected an ArtboardServiceError');
};

const threadOf = async (artboardId: string, id: string) =>
  (await asUser().listComments(artboardId)).find((thread) => thread.id === id)!;

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(projects).values({ id: projectId, name: 'Comments', userId });
  await db.insert(topics).values({ id: topicId, projectId, title: '需求讨论', userId });
  await registerCanvas('cvs_c1');
  await registerCanvas('cvs_c2');
});

afterEach(async () => {
  await db.delete(tasks).where(eq(tasks.createdByUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('ArtboardService comment delivery', () => {
  it('marks a thread unread until the agent takes it, and again on a new user reply', async () => {
    const { artboard } = await create();
    const thread = await asUser().addComment(artboard.id, { clientId: 'c1', content: '太挤了' });
    expect((await threadOf(artboard.id, thread.id)).unread).toBe(true);

    await asAgent().takeUndeliveredComments(artboard.id);
    expect((await threadOf(artboard.id, thread.id)).unread).toBe(false);

    await asAgent().replyComment(thread.id, { content: '已拉开' });
    expect((await threadOf(artboard.id, thread.id)).unread).toBe(false);

    await asUser().replyComment(thread.id, { clientId: 'c2', content: '还是挤' });
    expect((await threadOf(artboard.id, thread.id)).unread).toBe(true);
  });

  it('drops a thread the user resolved from the unread set and from the agent', async () => {
    const { artboard } = await create();
    const thread = await asUser().addComment(artboard.id, { clientId: 'c1', content: '算了' });
    await asUser().resolveComment(thread.id);

    expect((await threadOf(artboard.id, thread.id)).unread).toBe(false);
    expect(await asUser().countUndeliveredComments(artboard.id)).toBe(0);
    expect(await asAgent().takeUndeliveredComments(artboard.id)).toEqual([]);
  });

  it('keeps comments on the options of an open round from the agent until it is submitted', async () => {
    const { artboard, journey, option, round } = await create();
    const quiet = await asUser().addComment(artboard.id, {
      anchor: { type: 'canvas', x: 0.5, y: 0.5 },
      boardId: option.id,
      clientId: 'c1',
      content: 'A 的按钮太小',
    });
    const loud = await asUser().addComment(artboard.id, {
      anchor: { type: 'canvas', x: 0.1, y: 0.2 },
      boardId: journey.id,
      clientId: 'c2',
      content: '首页缺标题',
    });

    expect(await asUser().countUndeliveredComments(artboard.id)).toBe(1);
    const first = await asAgent().takeUndeliveredComments(artboard.id);
    expect(first.map((thread) => thread.id)).toEqual([loud.id]);
    expect((await threadOf(artboard.id, quiet.id)).unread).toBe(true);

    await asUser().submitRound(artboard.id, round.id);
    expect(await asUser().countUndeliveredComments(artboard.id)).toBe(1);
    const second = await asAgent().takeUndeliveredComments(artboard.id);
    expect(second.map((thread) => thread.id)).toContain(quiet.id);
    expect((await threadOf(artboard.id, quiet.id)).unread).toBe(false);
  });

  it('counts threads, not messages', async () => {
    const { artboard } = await create();
    const thread = await asUser().addComment(artboard.id, { clientId: 'c1', content: '一' });
    await asUser().replyComment(thread.id, { clientId: 'c2', content: '二' });
    await asUser().addComment(artboard.id, { clientId: 'c3', content: '三' });

    expect(await asUser().countUndeliveredComments(artboard.id)).toBe(2);
  });
});

describe('ArtboardService comment anchors', () => {
  it('flags a board thread as stale once the board moves to another Canvas version', async () => {
    const { artboard, journey } = await create();
    const onBoard = await asUser().addComment(artboard.id, {
      anchor: { type: 'canvas', x: 0.5, y: 0.5 },
      boardId: journey.id,
      clientId: 'c1',
      content: '按钮颜色',
    });
    const onCanvas = await asUser().addComment(artboard.id, { clientId: 'c2', content: '整体' });
    expect((await threadOf(artboard.id, onBoard.id)).stale).toBe(false);

    await registerCanvas('cvs_c1');
    await asUser().update(artboard.id, artboard.revision, [
      {
        id: journey.id,
        patch: { source: { canvasId: 'cvs_c1', kind: 'canvas' } },
        type: 'updateBoard',
      },
    ]);

    expect((await threadOf(artboard.id, onBoard.id)).stale).toBe(true);
    expect((await threadOf(artboard.id, onCanvas.id)).stale).toBe(false);
  });

  it('refuses a board anchor outside the board', async () => {
    const { artboard, journey } = await create();
    const error = await errorOf(
      asUser().addComment(artboard.id, {
        anchor: { type: 'canvas', x: 320, y: 0.5 },
        boardId: journey.id,
        clientId: 'c1',
        content: '外面',
      }),
    );
    expect(error.code).toBe('invalid');
  });
});
