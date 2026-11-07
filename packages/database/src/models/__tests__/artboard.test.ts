// @vitest-environment node
import { EMPTY_ARTBOARD_CONTENT } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { artboards, projects, tasks, users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ArtboardModel, ArtboardRevisionConflictError } from '../artboard';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'artboard-model-user';
const otherUserId = 'artboard-model-other';
const workspaceId = 'artboard-model-ws';

const personal = new ArtboardModel(serverDB, userId);
const inWorkspace = new ArtboardModel(serverDB, userId, workspaceId);

const seedTask = (id: string, seq: number, scope?: string) =>
  serverDB.insert(tasks).values({
    createdByUserId: userId,
    id,
    identifier: `T-${seq}`,
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
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 'artboard-model-ws' });
  await serverDB.insert(workspaceMembers).values([
    { userId, workspaceId },
    { userId: otherUserId, workspaceId },
  ]);
  await serverDB.insert(projects).values({ id: 'prj_art', name: 'Onboarding', userId });
  await seedTask('task_art_1', 1);
  await seedTask('task_art_2', 2);
  await seedTask('task_art_ws', 3, workspaceId);
});

afterEach(async () => {
  await serverDB
    .delete(tasks)
    .where(inArray(tasks.id, ['task_art_1', 'task_art_2', 'task_art_ws']));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await cleanup();
});

const create = (model: ArtboardModel, taskId: string) =>
  model.create({
    content: EMPTY_ARTBOARD_CONTENT,
    projectId: 'prj_art',
    taskId,
    title: '新用户首次进入项目',
  });

describe('ArtboardModel', () => {
  it('creates a board at revision 1 in the discuss phase', async () => {
    const board = await create(personal, 'task_art_1');

    expect(board.id.startsWith('art_')).toBe(true);
    expect(board).toMatchObject({ phase: 'discuss', revision: 1, taskId: 'task_art_1', userId });
  });

  it('finds a board by id, by task, and lists a project', async () => {
    const board = await create(personal, 'task_art_1');
    await create(personal, 'task_art_2');

    expect((await personal.findById(board.id))?.id).toBe(board.id);
    expect((await personal.findByTaskId('task_art_1'))?.id).toBe(board.id);
    expect(await personal.listByProject('prj_art')).toHaveLength(2);
  });

  it('refuses a second board for the same task', async () => {
    await create(personal, 'task_art_1');

    await expect(create(personal, 'task_art_1')).rejects.toThrow();
  });

  it('bumps the revision on update and rejects a stale revision', async () => {
    const board = await create(personal, 'task_art_1');
    const content = {
      ...EMPTY_ARTBOARD_CONTENT,
      groups: [{ desc: '', id: 'g1', kind: 'journey' as const, title: '旅程' }],
    };

    const updated = await personal.update(board.id, { content, expectedRevision: 1 });
    expect(updated.revision).toBe(2);
    expect(updated.content.groups).toHaveLength(1);
    expect(await personal.getRevision(board.id)).toBe(2);

    await expect(
      personal.update(board.id, { content, expectedRevision: 1 }),
    ).rejects.toBeInstanceOf(ArtboardRevisionConflictError);
  });

  it('keeps personal and workspace boards apart', async () => {
    const personalBoard = await create(personal, 'task_art_1');
    const workspaceBoard = await create(inWorkspace, 'task_art_ws');

    expect(workspaceBoard.workspaceId).toBe(workspaceId);
    expect(await inWorkspace.findById(personalBoard.id)).toBeUndefined();
    expect(await personal.findById(workspaceBoard.id)).toBeUndefined();
    expect(
      await new ArtboardModel(serverDB, otherUserId).findById(personalBoard.id),
    ).toBeUndefined();
  });

  it('cascades when the task is deleted', async () => {
    const board = await create(personal, 'task_art_1');
    await serverDB.delete(tasks).where(eq(tasks.id, 'task_art_1'));

    const rows = await serverDB.select().from(artboards).where(eq(artboards.id, board.id));
    expect(rows).toHaveLength(0);
  });

  it('denies another workspace member every private-task board read and write', async () => {
    const board = await create(inWorkspace, 'task_art_ws');
    const member = new ArtboardModel(serverDB, otherUserId, workspaceId);
    await serverDB.update(tasks).set({ visibility: 'private' }).where(eq(tasks.id, board.taskId));

    expect(await member.findById(board.id)).toBeUndefined();
    expect(await member.findByTaskId(board.taskId)).toBeUndefined();
    expect(await member.getRevision(board.id)).toBeUndefined();
    expect(await member.listByProject('prj_art')).toEqual([]);
    await expect(
      member.update(board.id, { expectedRevision: 1, title: 'Changed' }),
    ).rejects.toThrow();
    expect(await inWorkspace.findById(board.id)).toMatchObject({ revision: 1, title: board.title });
  });

  it('follows parent visibility changes and excludes trashed parents', async () => {
    const board = await create(inWorkspace, 'task_art_ws');
    const member = new ArtboardModel(serverDB, otherUserId, workspaceId);
    await serverDB.update(tasks).set({ visibility: 'public' }).where(eq(tasks.id, board.taskId));

    expect(await member.findById(board.id)).toMatchObject({ id: board.id });
    await member.update(board.id, { expectedRevision: 1, title: 'Shared edit' });
    await serverDB.update(tasks).set({ isDeleted: true }).where(eq(tasks.id, board.taskId));

    expect(await inWorkspace.findById(board.id)).toBeUndefined();
    expect(await member.findByTaskId(board.taskId)).toBeUndefined();
    expect(await member.getRevision(board.id)).toBeUndefined();
    expect(await inWorkspace.listByProject('prj_art')).toEqual([]);
    await expect(
      inWorkspace.update(board.id, { expectedRevision: 2, title: 'Trash edit' }),
    ).rejects.toThrow();
  });
});
