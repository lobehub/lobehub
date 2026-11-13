// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import type { ArtboardOp } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { WorkModel } from '@/database/models/work';
import {
  acceptanceFlowEdges,
  acceptanceFlowNodes,
  acceptanceFlows,
  agents,
  artboardBoards,
  artboardComments,
  artboardGroups,
  files,
  projects,
  tasks,
  topics,
  users,
  works,
} from '@/database/schemas';

import { ArtboardServiceError } from '../errors';
import { ArtboardService } from '../index';
import { type ArtboardSourceResolver, createArtboardSourceResolver } from '../sources';

const userId = 'artboard-service-user';
const projectId = 'prj_artboard_service';
const projectTopicId = 'tpc_artboard_project';
const looseTopicId = 'tpc_artboard_loose';
const context = { topicId: projectTopicId };

const db: LobeChatDatabase = await getTestDB();

const sources: ArtboardSourceResolver = {
  ...createArtboardSourceResolver(db, { userId }),
  image: async (fileRef) => (fileRef === 'msg_1.image_1' ? 'file_shot' : undefined),
  imageUrl: async (fileId) => `https://files.test/${fileId}`,
};

const service = () =>
  new ArtboardService(db, userId, undefined, { context: { agentId: null }, sources });

const registerCanvas = (canvasId: string, title: string) =>
  new WorkModel(db, userId).registerCanvas({
    canvasId,
    metadata: {
      entry: 'index.html',
      fileCount: 1,
      manifestKey: `canvas/${canvasId}/${Date.now()}.json`,
      runtimeMajor: 1,
      totalSize: 1,
    },
    title,
    toolIdentifier: 'lobe-canvas',
    toolName: 'createCanvas',
  });

const canvasBoard = (ref: string, canvasId: string, x: number, groupId = 'j'): ArtboardOp => ({
  board: { groupId, source: { canvasId, kind: 'canvas' }, title: ref, x, y: 0 },
  ref,
  type: 'addBoard',
});

const journeyOps = (): ArtboardOp[] => [
  { group: { kind: 'journey', title: '首次进入' }, ref: 'j', type: 'addGroup' },
  canvasBoard('empty', 'cvs_a', 0),
  canvasBoard('ingest', 'cvs_b', 720),
  { edge: { from: 'empty', label: '点接入', to: 'ingest' }, type: 'addEdge' },
];

const optionOps = (): ArtboardOp[] => [
  { ref: 'r', round: { title: '布局' }, type: 'addRound' },
  { group: { kind: 'options', title: '方案' }, ref: 'o', type: 'addGroup' },
  {
    board: {
      groupId: 'o',
      recommended: true,
      roundId: 'r',
      source: { canvasId: 'cvs_a', kind: 'canvas' },
      title: 'A',
      x: 0,
      y: 600,
    },
    type: 'addBoard',
  },
  {
    board: {
      groupId: 'o',
      roundId: 'r',
      source: { canvasId: 'cvs_b', kind: 'canvas' },
      title: 'B',
      x: 720,
      y: 600,
    },
    type: 'addBoard',
  },
];

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtboardServiceError) return error;
    throw error;
  }
  throw new Error('expected an ArtboardServiceError');
};

const createJourney = (extra: ArtboardOp[] = []) =>
  service().create({ ops: [...journeyOps(), ...extra], title: '画板' }, context);

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
  await db.insert(topics).values([
    { id: projectTopicId, projectId, title: '需求讨论', userId },
    { id: looseTopicId, title: '随便聊聊', userId },
  ]);
  await db
    .insert(files)
    .values({
      fileType: 'image/png',
      id: 'file_shot',
      name: 'shot.png',
      size: 1,
      url: 's',
      userId,
    });
  await registerCanvas('cvs_a', '空项目');
  await registerCanvas('cvs_b', '接入资料');
});

afterEach(async () => {
  await db.delete(tasks).where(eq(tasks.createdByUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('ArtboardService.create', () => {
  it('uses the task passed in, and stores each board as a row with its Canvas version', async () => {
    const task = await new TaskModel(db, userId).create({ instruction: '首次进入', projectId });
    const result = await service().create(
      { ops: journeyOps(), taskId: task.identifier, title: '新用户首次进入项目' },
      { topicId: looseTopicId },
    );

    expect(result.artboard).toMatchObject({
      phase: 'discuss',
      projectId,
      revision: 1,
      taskId: task.id,
      topicId: looseTopicId,
    });
    expect(result.createdTask).toBe(false);
    const { boards, edges, groups, pages } = result.artboard.content;
    expect(pages).toHaveLength(1);
    expect(boards.map((b) => b.source)).toEqual([
      { canvasId: 'cvs_a', kind: 'canvas', version: 1 },
      { canvasId: 'cvs_b', kind: 'canvas', version: 1 },
    ]);
    expect(boards.map((b) => b.type)).toEqual(['html', 'html']);
    expect(edges).toMatchObject([{ from: boards[0].id, label: '点接入', to: boards[1].id }]);
    expect(result.changedIds).toEqual([groups[0].id, boards[0].id, boards[1].id, edges[0].id]);

    const rows = await db
      .select()
      .from(artboardBoards)
      .where(eq(artboardBoards.projectId, projectId));
    expect(rows).toHaveLength(2);
  });

  it('wraps a group around its boards and keeps board positions in page coordinates', async () => {
    const { artboard } = await createJourney();
    const [group] = artboard.content.groups;

    expect(group.rect).toEqual({ h: 400 + 144 + 48, w: 720 + 640 + 96, x: -48, y: -144 });
    expect(artboard.content.boards.map((b) => b.rect)).toEqual([
      { h: 400, w: 640, x: 0, y: 0 },
      { h: 400, w: 640, x: 720, y: 0 },
    ]);
    const stored = await db
      .select({ rect: artboardBoards.rect })
      .from(artboardBoards)
      .where(eq(artboardBoards.groupId, group.id));
    expect(stored.map((row) => row.rect.x).sort((a, b) => a - b)).toEqual([48, 768]);
  });

  it('creates a task in the conversation’s project when none is given', async () => {
    const result = await service().create(
      { description: '讨论首次进入的流程', title: '首次进入' },
      context,
    );

    expect(result.createdTask).toBe(true);
    const [task] = await db.select().from(tasks).where(eq(tasks.id, result.artboard.taskId!));
    expect(task).toMatchObject({ name: '首次进入', projectId });
  });

  it('creates neither a board nor a task when an op is refused', async () => {
    const error = await errorOf(
      service().create(
        {
          ops: [
            { group: { kind: 'journey', title: 'A' }, type: 'addGroup' },
            { group: { kind: 'journey', title: 'B' }, type: 'addGroup' },
          ],
          title: '画板',
        },
        context,
      ),
    );

    expect(error).toMatchObject({ code: 'invalid', data: { opIndex: 1 } });
    expect(await db.select().from(tasks).where(eq(tasks.createdByUserId, userId))).toEqual([]);
    expect(await db.select().from(artboardGroups).where(eq(artboardGroups.userId, userId))).toEqual(
      [],
    );
  });

  it('refuses a board outside any project', async () => {
    const error = await errorOf(service().create({ title: '画板' }, { topicId: looseTopicId }));
    expect(error.code).toBe('no_project');
  });

  it('refuses a second board for one task and names the first', async () => {
    const task = await new TaskModel(db, userId).create({ instruction: 'x', projectId });
    const first = await service().create({ taskId: task.id, title: 'A' }, {});

    const error = await errorOf(service().create({ taskId: task.id, title: 'B' }, {}));
    expect(error.code).toBe('exists');
    expect(error.data.artboardId).toBe(first.artboard.id);
  });

  it('refuses a Canvas the user cannot open, and stores image refs as files', async () => {
    const denied = await errorOf(
      service().create(
        {
          ops: [
            { group: { kind: 'references', title: '参考' }, ref: 'o', type: 'addGroup' },
            canvasBoard('x', 'cvs_x', 0, 'o'),
          ],
          title: '画板',
        },
        context,
      ),
    );
    expect(denied).toMatchObject({ code: 'source_denied', data: { opIndex: 1 } });

    const created = await service().create(
      {
        ops: [
          { group: { kind: 'references', title: '参考' }, ref: 'r', type: 'addGroup' },
          {
            board: {
              groupId: 'r',
              source: { fileRef: 'msg_1.image_1', kind: 'image' },
              title: '截图',
              x: 0,
              y: 0,
            },
            type: 'addBoard',
          },
        ],
        title: '画板',
      },
      context,
    );
    expect(created.artboard.content.boards[0]).toMatchObject({
      source: { fileId: 'file_shot', kind: 'image' },
      type: 'image',
    });
    expect((await service().get(created.artboard.id)).imageUrls).toEqual({
      file_shot: 'https://files.test/file_shot',
    });
  });
});

describe('ArtboardService.update and read', () => {
  it('rejects a stale revision and flags boards behind their Canvas', async () => {
    const { artboard } = await createJourney();
    const [first, second] = artboard.content.boards;

    const updated = await service().update(artboard.id, 1, [
      { id: first.id, patch: { title: '新的空项目' }, type: 'updateBoard' },
    ]);
    expect(updated).toMatchObject({ artboard: { revision: 2 }, changedIds: [first.id] });

    const stale = await errorOf(
      service().update(artboard.id, 1, [{ id: second.id, type: 'removeBoard' }]),
    );
    expect(stale.code).toBe('conflict');

    await registerCanvas('cvs_b', '接入资料');
    const read = await service().read(artboard.id);
    expect(read.staleBoardIds).toEqual([second.id]);
    expect(read.canvases.cvs_b).toEqual({ latestVersion: 2, title: '接入资料' });
  });

  it('applies none of a batch when one op fails', async () => {
    const { artboard } = await createJourney();

    const error = await errorOf(
      service().update(artboard.id, 1, [
        { group: { kind: 'other', title: '其他' }, type: 'addGroup' },
        { id: 'nope', type: 'removeBoard' },
      ]),
    );

    expect(error).toMatchObject({ code: 'not_found', data: { opIndex: 1 } });
    const read = await service().read(artboard.id);
    expect(read.artboard.revision).toBe(1);
    expect(read.artboard.content.groups).toHaveLength(1);
  });

  it('moves the group and its siblings’ stored rects when a board moves left', async () => {
    const { artboard } = await createJourney();
    const [first] = artboard.content.boards;

    const { artboard: next } = await service().update(artboard.id, 1, [
      { id: first.id, patch: { x: -720 }, type: 'updateBoard' },
    ]);

    expect(next.content.groups[0].rect).toMatchObject({ w: 1440 + 640 + 96, x: -768 });
    expect(next.content.boards.map((b) => b.rect.x)).toEqual([-720, 720]);
  });

  it('shows no source for a board whose Canvas went to the trash', async () => {
    const { artboard } = await createJourney();
    const canvas = await new WorkModel(db, userId).findCanvas('cvs_a');
    await db
      .update(works)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(works.id, canvas!.work.id));

    const read = await service().read(artboard.id);
    expect(read.artboard.content.boards.map((b) => b.source?.kind ?? null)).toEqual([
      null,
      'canvas',
    ]);
  });

  it('keeps one journey, checks only on journey boards, and options inside a round', async () => {
    const { artboard } = await createJourney();
    const id = artboard.id;

    const second = await errorOf(
      service().update(id, 1, [{ group: { kind: 'journey', title: 'B' }, type: 'addGroup' }]),
    );
    expect(second.code).toBe('invalid');

    const check = await errorOf(
      service().update(id, 1, [
        { group: { kind: 'references', title: '参考' }, ref: 'r', type: 'addGroup' },
        {
          board: {
            expected: '看到',
            groupId: 'r',
            source: { canvasId: 'cvs_a', kind: 'canvas' },
            title: 'x',
            x: 0,
            y: 900,
          },
          type: 'addBoard',
        },
      ]),
    );
    expect(check).toMatchObject({ code: 'invalid', data: { opIndex: 1 } });

    const loose = await errorOf(
      service().update(id, 1, [
        { group: { kind: 'options', title: '方案' }, ref: 'o', type: 'addGroup' },
        canvasBoard('a', 'cvs_a', 0, 'o'),
      ]),
    );
    expect(loose).toMatchObject({ code: 'invalid', data: { opIndex: 1 } });

    const decision = await errorOf(
      service().update(id, 1, [
        {
          board: {
            groupId: artboard.content.groups[0].id,
            source: { canvasId: 'cvs_a', kind: 'canvas' },
            title: '付费？',
            type: 'decision',
            x: 0,
            y: 0,
          },
          type: 'addBoard',
        },
      ]),
    );
    expect(decision.code).toBe('invalid');
  });
});

describe('ArtboardService rounds', () => {
  it('records the recommendation, lets the user pick, and submits the round', async () => {
    const { artboard } = await createJourney(optionOps());
    const [round] = artboard.content.rounds;
    const options = artboard.content.boards.filter((b) => b.roundId === round.id);
    expect(round).toMatchObject({ recommendedBoardId: options[0].id, status: 'open' });

    const chosen = await service().chooseBoard(artboard.id, round.id, options[1].id);
    expect(chosen.artboard.content.rounds[0].chosenBoardId).toBe(options[1].id);
    expect(chosen.artboard.revision).toBe(1);

    const submitted = await service().submitRound(artboard.id, round.id);
    expect(submitted.artboard.content.rounds[0]).toMatchObject({
      chosenBoardId: options[1].id,
      status: 'submitted',
    });

    const late = await errorOf(service().chooseBoard(artboard.id, round.id, options[0].id));
    expect(late.code).toBe('locked');
    const removal = await errorOf(
      service().update(artboard.id, 1, [{ id: options[1].id, type: 'removeBoard' }]),
    );
    expect(removal.code).toBe('locked');
  });

  it('refuses a round of another board', async () => {
    const { artboard } = await createJourney(optionOps());
    const other = await service().create({ title: '另一块' }, context);

    const error = await errorOf(
      service().submitRound(other.artboard.id, artboard.content.rounds[0].id),
    );
    expect(error.code).toBe('not_found');
  });
});

describe('ArtboardService comments', () => {
  it('threads a user comment with replies and resolves it', async () => {
    const { artboard } = await createJourney();
    const [board] = artboard.content.boards;

    const thread = await service().addComment(artboard.id, {
      boardId: board.id,
      clientId: 'c1',
      content: '这里要不要空状态？',
    });
    await service().replyComment(thread.id, { clientId: 'c2', content: '要' });

    const [listed] = await service().listComments(artboard.id);
    expect(listed).toMatchObject({
      authorUserId: userId,
      boardId: board.id,
      pageId: board.pageId,
      replies: [{ content: '要' }],
      resolvedAt: null,
    });

    const resolved = await service().resolveComment(thread.id);
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect((await service().reopenComment(thread.id)).resolvedAt).toBeNull();
    expect((await service().read(artboard.id)).artboard.revision).toBe(1);
  });
});

describe('ArtboardService agent questions', () => {
  const agentId = 'agt_artboard_service';
  const asAgent = () =>
    new ArtboardService(db, userId, undefined, { context: { agentId }, sources });

  beforeEach(async () => {
    await db.insert(agents).values({ id: agentId, userId });
  });

  it('opens a question thread that shows on the board until it is resolved', async () => {
    const { artboard } = await createJourney();
    const [board] = artboard.content.boards;

    const question = await asAgent().askQuestion(artboard.id, {
      boardId: board.id,
      content: '这一步能跳过吗？',
    });

    expect((await service().read(artboard.id)).artboard.content.questions).toEqual([
      {
        boardId: board.id,
        content: '这一步能跳过吗？',
        groupId: null,
        id: question.id,
        pageId: board.pageId,
      },
    ]);
    await service().resolveComment(question.id);
    expect((await service().read(artboard.id)).artboard.content.questions).toEqual([]);
  });

  it('refuses a question outside an agent run', async () => {
    const { artboard } = await createJourney();
    expect(() => service().askQuestion(artboard.id, { content: '？' })).toThrow(
      ArtboardServiceError,
    );
  });

  it('hands unresolved threads to the agent and marks them delivered', async () => {
    const { artboard } = await createJourney();
    const thread = await service().addComment(artboard.id, { clientId: 'c1', content: '太挤了' });
    await asAgent().replyComment(thread.id, { content: '已拉开间距' });

    const taken = await asAgent().takeUndeliveredComments(artboard.id);
    expect(taken).toMatchObject([
      { content: '太挤了', replies: [{ authorAgentId: agentId, content: '已拉开间距' }] },
    ]);
    const rows = await db
      .select({ deliveredAt: artboardComments.deliveredAt })
      .from(artboardComments)
      .where(eq(artboardComments.artboardId, artboard.id));
    expect(rows.every((row) => row.deliveredAt instanceof Date)).toBe(true);
  });
});

describe('ArtboardService.finalize', () => {
  const checks = (refs: string[]): ArtboardOp[] =>
    refs.map((boardId) => ({ boardId, expected: `看到 ${boardId}`, type: 'setCheck' }));

  it('lists what is missing before it will finalize', async () => {
    const { artboard } = await createJourney(optionOps());
    const [first, second] = artboard.content.boards;

    const error = await errorOf(service().finalize(artboard.id, artboard.revision));
    expect(error.code).toBe('finalize_blocked');
    expect(error.data.issues).toEqual([
      { boardId: first.id, code: 'missing_check' },
      { boardId: second.id, code: 'missing_check' },
      { code: 'open_round', roundId: artboard.content.rounds[0].id },
    ]);
  });

  it('publishes the journey as an acceptance flow once, and locks it', async () => {
    const created = await createJourney(checks(['empty', 'ingest']));

    const result = await service().finalize(created.artboard.id, created.artboard.revision);
    expect(result.artboard).toMatchObject({
      acceptanceId: result.acceptanceId,
      phase: 'finalized',
      revision: 2,
    });
    const [entry, next] = result.artboard.content.boards;
    const [edge] = result.artboard.content.edges;
    const [flow] = await db
      .select()
      .from(acceptanceFlows)
      .where(eq(acceptanceFlows.acceptanceId, result.acceptanceId));
    const nodes = await db
      .select()
      .from(acceptanceFlowNodes)
      .where(eq(acceptanceFlowNodes.flowId, flow.id));
    expect(nodes.map((node) => node.id).sort()).toEqual([entry.flowNodeId, next.flowNodeId].sort());
    const flowEdges = await db
      .select()
      .from(acceptanceFlowEdges)
      .where(eq(acceptanceFlowEdges.flowId, flow.id));
    expect(flowEdges).toMatchObject([{ id: edge.flowEdgeId, trigger: '点接入' }]);

    const again = await service().finalize(created.artboard.id, 1);
    expect(again.acceptanceId).toBe(result.acceptanceId);
    expect(again.artboard.revision).toBe(2);

    const locked = await errorOf(
      service().update(created.artboard.id, 2, [
        { id: entry.id, patch: { title: '改名' }, type: 'updateBoard' },
      ]),
    );
    expect(locked.code).toBe('locked');
    const moved = await service().update(created.artboard.id, 2, [
      { id: entry.id, patch: { x: -40 }, type: 'updateBoard' },
    ]);
    expect(moved.artboard.revision).toBe(3);
  });

  it('collapses a decision board into conditioned edges between the screens around it', async () => {
    const created = await service().create(
      {
        ops: [
          { group: { kind: 'journey', title: '付费' }, ref: 'j', type: 'addGroup' },
          canvasBoard('cart', 'cvs_a', 0),
          {
            board: { groupId: 'j', title: '已付费？', type: 'decision', x: 720, y: 0 },
            ref: 'paid',
            type: 'addBoard',
          },
          canvasBoard('done', 'cvs_b', 1440),
          { edge: { from: 'cart', label: '点结算', to: 'paid' }, type: 'addEdge' },
          { edge: { condition: '已付费', from: 'paid', label: '是', to: 'done' }, type: 'addEdge' },
          ...checks(['cart', 'done']),
        ],
        title: '付费',
      },
      context,
    );

    const result = await service().finalize(created.artboard.id, 1);
    const [flow] = await db
      .select()
      .from(acceptanceFlows)
      .where(eq(acceptanceFlows.acceptanceId, result.acceptanceId));
    const nodes = await db
      .select()
      .from(acceptanceFlowNodes)
      .where(eq(acceptanceFlowNodes.flowId, flow.id));
    const flowEdges = await db
      .select()
      .from(acceptanceFlowEdges)
      .where(eq(acceptanceFlowEdges.flowId, flow.id));

    const boards = result.artboard.content.boards;
    expect(nodes).toHaveLength(2);
    expect(boards.find((b) => b.type === 'decision')?.flowNodeId).toBeNull();
    expect(flowEdges).toMatchObject([
      {
        condition: '已付费',
        sourceNodeId: boards[0].flowNodeId,
        targetNodeId: boards[2].flowNodeId,
        trigger: '点结算',
      },
    ]);
  });
});
