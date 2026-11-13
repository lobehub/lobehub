// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  acceptanceFlowNodes,
  acceptanceFlows,
  acceptances,
  artboardEdges,
  artboardGroups,
  artboardRounds,
  projects,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ArtboardModel } from '../index';
import { ArtboardStructureError, ArtboardStructureModel } from '../structure';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'artboard-structure-user';
const otherUserId = 'artboard-structure-other';
const workspaceId = 'artboard-structure-ws';
const projectId = 'prj_art_structure';
const taskIds = ['task_abs_1', 'task_abs_ws'];

const structure = new ArtboardStructureModel(serverDB, userId);

const seedTask = (id: string, seq: number, scope?: string) =>
  serverDB.insert(tasks).values({
    createdByUserId: userId,
    id,
    identifier: `S-${seq}`,
    instruction: 'design onboarding',
    seq,
    workspaceId: scope,
  });

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
  await serverDB.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
  await seedTask('task_abs_1', 1);
  await seedTask('task_abs_ws', 2, workspaceId);
});

afterEach(async () => {
  await serverDB.delete(tasks).where(inArray(tasks.id, taskIds));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await cleanup();
});

const seedArtboard = async (model = structure, artboards = new ArtboardModel(serverDB, userId)) => {
  const artboard = await artboards.create({ projectId, taskId: 'task_abs_1', title: '登录流程' });
  const [page] = (await model.getStructure(artboard.id))!.pages;
  return { artboard, page };
};

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

const board = (
  pageId: string,
  groupId: string | null,
  title: string,
  x = 0,
  roundId: string | null = null,
) => ({
  groupId,
  pageId,
  projectId,
  rect: { h: 400, w: 640, x, y: 0 },
  roundId,
  title,
  type: 'html' as const,
});

const seedOptions = async () => {
  const { artboard, page } = await seedArtboard();
  const round = await structure.createRound(artboard.id, {
    pageId: page.id,
    title: '登录方式用哪种',
  });
  const group = await structure.createGroup(artboard.id, {
    kind: 'options',
    pageId: page.id,
    rect: { h: 600, w: 1500, x: 0, y: 0 },
    title: '登录方式怎么摆',
  });
  const a = await structure.createBoard(artboard.id, board(page.id, group.id, '卡片', 0, round.id));
  const b = await structure.createBoard(
    artboard.id,
    board(page.id, group.id, '下拉', 720, round.id),
  );
  return { a, artboard, b, group, page, round };
};

const readRound = async (id: string) => {
  const [row] = await serverDB.select().from(artboardRounds).where(eq(artboardRounds.id, id));
  return row;
};

const expectCode = async (run: Promise<unknown>, code: string) => {
  await expect(run).rejects.toBeInstanceOf(ArtboardStructureError);
  await expect(run).rejects.toMatchObject({ code });
};

describe('ArtboardStructureModel', () => {
  it('reads back pages, rounds, groups, boards and edges of an artboard', async () => {
    const { a, artboard, b, group, page, round } = await seedOptions();
    const edge = await structure.createEdge(artboard.id, {
      condition: '已有账号',
      label: '点击登录',
      sourceBoardId: a.id,
      targetBoardId: b.id,
    });

    const read = await structure.getStructure(artboard.id);

    expect(read?.pages.map((p) => p.id)).toEqual([page.id]);
    expect(read?.rounds).toMatchObject([{ chosenBoardId: null, id: round.id, status: 'open' }]);
    expect(read?.groups).toMatchObject([{ id: group.id, kind: 'options' }]);
    expect(read?.boards.map((item) => item.title)).toEqual(['卡片', '下拉']);
    expect(read?.boards[0]).toMatchObject({ roundId: round.id, type: 'html' });
    expect(read?.edges).toMatchObject([
      { condition: '已有账号', id: edge.id, isDefault: false, label: '点击登录', sortOrder: 0 },
    ]);
    expect(a.id).toMatch(uuid);
  });

  it('reads rows written in one transaction back in the order they were written', async () => {
    const { artboard, page } = await seedArtboard();

    await serverDB.transaction(async (tx) => {
      const model = structure.withTransaction(tx);
      for (const title of ['one', 'two', 'three', 'four', 'five', 'six'])
        await model.createBoard(artboard.id, board(page.id, null, title));
    });

    const { boards } = (await structure.getStructure(artboard.id))!;
    expect(boards.map((b) => b.title)).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
  });

  it('updates a board in place', async () => {
    const { a } = await seedOptions();

    const moved = await structure.updateBoard(a.id, {
      expected: '看到登录表单',
      rect: { h: 400, w: 640, x: 80, y: 0 },
    });

    expect(moved).toMatchObject({
      expected: '看到登录表单',
      id: a.id,
      rect: { x: 80 },
      title: '卡片',
    });
  });

  it('places a board outside any group', async () => {
    const { artboard, page } = await seedArtboard();

    const loose = await structure.createBoard(artboard.id, board(page.id, null, '散落的参考图'));

    expect(loose).toMatchObject({ groupId: null, roundId: null });
  });

  it('refuses a board on a different page from its group or round', async () => {
    const { artboard, group, round } = await seedOptions();
    const other = await structure.createPage(artboard.id, { name: '第二页', sortOrder: 1 });

    await expectCode(
      structure.createBoard(artboard.id, board(other.id, group.id, '跨页')),
      'invalid',
    );
    await expectCode(
      structure.createBoard(artboard.id, board(other.id, null, '跨页', 0, round.id)),
      'invalid',
    );
  });

  it('removes a deleted board from its edges and from the round that pointed at it', async () => {
    const { a, artboard, b, round } = await seedOptions();
    await structure.createEdge(artboard.id, { sourceBoardId: a.id, targetBoardId: b.id });
    await structure.updateRound(round.id, { recommendedBoardId: a.id });
    await structure.chooseBoard(round.id, a.id);

    await structure.deleteBoard(a.id);

    expect(
      await serverDB.select().from(artboardEdges).where(eq(artboardEdges.artboardId, artboard.id)),
    ).toEqual([]);
    expect(await readRound(round.id)).toMatchObject({
      chosenBoardId: null,
      recommendedBoardId: null,
    });
  });

  it('refuses to delete a group that still holds boards', async () => {
    const { a, b, group } = await seedOptions();

    await expectCode(structure.deleteGroup(group.id), 'not_empty');

    await structure.deleteBoard(a.id);
    await structure.deleteBoard(b.id);
    await structure.deleteGroup(group.id);
    expect(
      await serverDB.select().from(artboardGroups).where(eq(artboardGroups.id, group.id)),
    ).toEqual([]);
  });

  it('refuses to delete a page with content, and the last page', async () => {
    const { artboard, page } = await seedOptions();
    const empty = await structure.createPage(artboard.id, { name: '验收', sortOrder: 1 });

    await expectCode(structure.deletePage(page.id), 'not_empty');

    await structure.deletePage(empty.id);
    const { artboard: single, page: only } = await seedArtboard();
    await expectCode(structure.deletePage(only.id), 'last_page');
    expect((await structure.getStructure(single.id))?.pages).toHaveLength(1);
  });

  it('refuses a board whose group belongs to another artboard', async () => {
    const { group } = await seedOptions();
    const other = await new ArtboardModel(serverDB, userId, workspaceId).create({
      taskId: 'task_abs_ws',
      title: '另一块画板',
    });
    const inWorkspace = new ArtboardStructureModel(serverDB, userId, workspaceId);
    const [otherPage] = (await inWorkspace.getStructure(other.id))!.pages;

    await expectCode(
      inWorkspace.createBoard(other.id, board(otherPage.id, group.id, '串门')),
      'not_found',
    );
  });

  it('only recommends a board that is an option of the round', async () => {
    const { a, artboard, page, round } = await seedOptions();
    const elsewhere = await structure.createBoard(artboard.id, board(page.id, null, '无关'));

    await expectCode(
      structure.updateRound(round.id, { recommendedBoardId: elsewhere.id }),
      'not_found',
    );
    expect(await structure.updateRound(round.id, { recommendedBoardId: a.id })).toMatchObject({
      recommendedBoardId: a.id,
    });
  });

  it('keeps a choice as a draft that can change until the round is submitted', async () => {
    const { a, b, round } = await seedOptions();

    await structure.chooseBoard(round.id, a.id);
    const changed = await structure.chooseBoard(round.id, b.id);
    expect(changed).toMatchObject({ chosenBoardId: b.id, selectedBy: userId });
    expect(changed.selectedAt).toBeInstanceOf(Date);

    await structure.submitRound(round.id);
    await expectCode(structure.chooseBoard(round.id, a.id), 'round_submitted');
  });

  it('refuses a choice that is not an option of the round', async () => {
    const { artboard, page, round } = await seedOptions();
    const elsewhere = await structure.createBoard(artboard.id, board(page.id, null, '无关'));

    await expectCode(structure.chooseBoard(round.id, elsewhere.id), 'not_found');
  });

  it('applies the recommendation when a round is submitted unpicked', async () => {
    const { a, round } = await seedOptions();
    await structure.updateRound(round.id, { recommendedBoardId: a.id });

    const [submitted] = await structure.submitRound(round.id);

    expect(submitted).toMatchObject({
      chosenBoardId: a.id,
      selectedBy: userId,
      status: 'submitted',
    });
  });

  it('refuses to submit a round with neither a pick nor a recommendation', async () => {
    const { round } = await seedOptions();

    await expectCode(structure.submitRound(round.id), 'missing_choice');

    expect((await readRound(round.id)).status).toBe('open');
  });

  it('refuses to submit a round twice', async () => {
    const { a, round } = await seedOptions();
    await structure.chooseBoard(round.id, a.id);
    await structure.submitRound(round.id);

    await expectCode(structure.submitRound(round.id), 'round_submitted');
  });

  it('submits every round of a batch together', async () => {
    const { a, artboard, page, round } = await seedOptions();
    await structure.updateRound(round.id, { metadata: { batchId: 'b1' } });
    const second = await structure.createRound(artboard.id, {
      metadata: { batchId: 'b1' },
      pageId: page.id,
      title: '首页布局',
    });
    const solo = await structure.createRound(artboard.id, { pageId: page.id, title: '单独一题' });
    const c = await structure.createBoard(artboard.id, board(page.id, null, '双栏', 0, second.id));
    await structure.chooseBoard(round.id, a.id);

    await expectCode(structure.submitRound(round.id), 'missing_choice');
    expect((await readRound(round.id)).status).toBe('open');

    await structure.chooseBoard(second.id, c.id);
    const submitted = await structure.submitRound(second.id);

    expect(submitted.map((item) => item.id).sort()).toEqual([round.id, second.id].sort());
    expect((await readRound(round.id)).status).toBe('submitted');
    expect((await readRound(solo.id)).status).toBe('open');
  });

  it('stores a decision board and its conditional branches', async () => {
    const { artboard, page } = await seedArtboard();
    const entry = await structure.createBoard(artboard.id, board(page.id, null, '商品页'));
    const decision = await structure.createBoard(artboard.id, {
      ...board(page.id, null, '已登录？'),
      type: 'decision',
    });
    const checkout = await structure.createBoard(artboard.id, board(page.id, null, '结算'));
    const login = await structure.createBoard(artboard.id, board(page.id, null, '登录'));

    await structure.createEdge(artboard.id, {
      label: '点击购买',
      sourceBoardId: entry.id,
      targetBoardId: decision.id,
    });
    await structure.createEdge(artboard.id, {
      condition: '已登录',
      sourceBoardId: decision.id,
      targetBoardId: checkout.id,
    });
    await structure.createEdge(artboard.id, {
      isDefault: true,
      sortOrder: 1,
      sourceBoardId: decision.id,
      targetBoardId: login.id,
    });

    await expect(
      structure.createEdge(artboard.id, {
        isDefault: true,
        sourceBoardId: decision.id,
        targetBoardId: entry.id,
      }),
    ).rejects.toThrow();
    await expect(
      structure.createBoard(artboard.id, {
        ...board(page.id, null, '带来源的判断'),
        sourcePath: 'index.html',
        type: 'decision',
      }),
    ).rejects.toThrow();
    const read = await structure.getStructure(artboard.id);
    expect(read?.edges.filter((edge) => edge.sourceBoardId === decision.id)).toHaveLength(2);
  });

  it('lists rounds of a project that have no effective choice yet', async () => {
    const { a, round } = await seedOptions();

    expect((await structure.listUndecidedRoundsByProject(projectId)).map((r) => r.id)).toEqual([
      round.id,
    ]);

    await structure.chooseBoard(round.id, a.id);
    expect(await structure.listUndecidedRoundsByProject(projectId)).toHaveLength(1);

    await structure.submitRound(round.id);
    expect(await structure.listUndecidedRoundsByProject(projectId)).toEqual([]);
  });

  it('finds the board behind an acceptance item', async () => {
    const { a } = await seedOptions();
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 'task_abs_1', subjectType: 'task', userId })
      .returning();
    const [flow] = await serverDB
      .insert(acceptanceFlows)
      .values({ acceptanceId: acceptance.id, title: '主流程' })
      .returning();
    const [node] = await serverDB
      .insert(acceptanceFlowNodes)
      .values({ flowId: flow.id, subFlowId: flow.id })
      .returning();

    await structure.updateBoard(a.id, { acceptanceFlowNodeId: node.id });
    expect((await structure.findBoardByAcceptanceNode(node.id))?.id).toBe(a.id);
  });

  it('keeps the acceptance link when the flow is republished with the same node id', async () => {
    const { a } = await seedOptions();
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 'task_abs_1', subjectType: 'task', userId })
      .returning();
    const [flow] = await serverDB
      .insert(acceptanceFlows)
      .values({ acceptanceId: acceptance.id, title: '主流程' })
      .returning();
    const [node] = await serverDB
      .insert(acceptanceFlowNodes)
      .values({ flowId: flow.id, subFlowId: flow.id })
      .returning();
    await structure.updateBoard(a.id, { acceptanceFlowNodeId: node.id });

    await serverDB.transaction(async (tx) => {
      await tx.delete(acceptanceFlowNodes).where(eq(acceptanceFlowNodes.flowId, flow.id));
      await tx
        .insert(acceptanceFlowNodes)
        .values({ flowId: flow.id, id: node.id, subFlowId: flow.id });
    });

    expect((await structure.findBoardByAcceptanceNode(node.id))?.id).toBe(a.id);
  });

  it('hides a private task from another member across every read and write', async () => {
    const owner = new ArtboardStructureModel(serverDB, userId, workspaceId);
    const artboard = await new ArtboardModel(serverDB, userId, workspaceId).create({
      projectId,
      taskId: 'task_abs_ws',
      title: '私有画板',
    });
    const [page] = (await owner.getStructure(artboard.id))!.pages;
    const group = await owner.createGroup(artboard.id, {
      kind: 'journey',
      pageId: page.id,
      rect: { h: 600, w: 1500, x: 0, y: 0 },
      title: '主流程',
    });
    const item = await owner.createBoard(artboard.id, board(page.id, group.id, '首页'));
    await serverDB.update(tasks).set({ visibility: 'private' }).where(eq(tasks.id, 'task_abs_ws'));
    const member = new ArtboardStructureModel(serverDB, otherUserId, workspaceId);

    expect(await member.getStructure(artboard.id)).toBeUndefined();
    expect(await member.listBoardsByProject(projectId)).toEqual([]);
    await expectCode(member.updateBoard(item.id, { title: '改掉' }), 'not_found');
    await expectCode(member.deleteBoard(item.id), 'not_found');
    await expectCode(
      member.createBoard(artboard.id, board(page.id, group.id, '塞一张')),
      'not_found',
    );
    expect((await owner.listBoardsByProject(projectId)).map((b) => b.title)).toEqual(['首页']);
  });
});
