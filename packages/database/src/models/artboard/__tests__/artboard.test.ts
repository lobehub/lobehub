// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  artboardPages,
  projects,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ArtboardModel, ArtboardRevisionConflictError } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'artboard-model-user';
const otherUserId = 'artboard-model-other';
const workspaceId = 'artboard-model-ws';
const taskIds = ['task_art_1', 'task_art_2', 'task_art_ws'];

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
  await serverDB.delete(tasks).where(inArray(tasks.id, taskIds));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await cleanup();
});

const create = (model: ArtboardModel, taskId: string) =>
  model.create({ projectId: 'prj_art', taskId, title: '新用户首次进入项目' });

describe('ArtboardModel', () => {
  it('creates an artboard at revision 1 in the discuss phase with one page', async () => {
    const artboard = await create(personal, 'task_art_1');

    expect(artboard.id.startsWith('art_')).toBe(true);
    expect(artboard).toMatchObject({
      content: null,
      phase: 'discuss',
      revision: 1,
      taskId: 'task_art_1',
      userId,
    });
    const pages = await serverDB
      .select()
      .from(artboardPages)
      .where(eq(artboardPages.artboardId, artboard.id));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ sortOrder: 0, userId });
  });

  it('finds an artboard by id, by task, and lists a project', async () => {
    const artboard = await create(personal, 'task_art_1');
    await create(personal, 'task_art_2');

    expect((await personal.findById(artboard.id))?.id).toBe(artboard.id);
    expect((await personal.listByTaskId('task_art_1')).map((row) => row.id)).toEqual([artboard.id]);
    expect(await personal.listByProject('prj_art')).toHaveLength(2);
  });

  it('allows several artboards per task, and an artboard with no task', async () => {
    await create(personal, 'task_art_1');
    await create(personal, 'task_art_1');
    const loose = await personal.create({
      content: '# 背景\n新用户第一次进项目时什么都看不到。',
      description: '新用户首次进入项目的引导',
      title: '没有任务的画板',
    });

    expect(await personal.listByTaskId('task_art_1')).toHaveLength(2);
    expect(await personal.findById(loose.id)).toMatchObject({
      content: '# 背景\n新用户第一次进项目时什么都看不到。',
      taskId: null,
    });
  });

  it('scopes an artboard with no task by its workspace', async () => {
    const loose = await inWorkspace.create({ title: '工作区画板' });

    expect(
      await new ArtboardModel(serverDB, otherUserId, workspaceId).findById(loose.id),
    ).toMatchObject({ id: loose.id });
    expect(await personal.findById(loose.id)).toBeUndefined();
  });

  it('bumps the revision on update and rejects a stale revision', async () => {
    const artboard = await create(personal, 'task_art_1');

    const updated = await personal.update(artboard.id, { expectedRevision: 1, title: '改名' });
    expect(updated).toMatchObject({ revision: 2, title: '改名' });
    expect(await personal.getRevision(artboard.id)).toBe(2);

    await expect(
      personal.update(artboard.id, { expectedRevision: 1, title: '过期写入' }),
    ).rejects.toBeInstanceOf(ArtboardRevisionConflictError);
  });

  it('keeps personal and workspace artboards apart', async () => {
    const personalArtboard = await create(personal, 'task_art_1');
    const workspaceArtboard = await create(inWorkspace, 'task_art_ws');

    expect(workspaceArtboard.workspaceId).toBe(workspaceId);
    expect(await inWorkspace.findById(personalArtboard.id)).toBeUndefined();
    expect(await personal.findById(workspaceArtboard.id)).toBeUndefined();
    expect(
      await new ArtboardModel(serverDB, otherUserId).findById(personalArtboard.id),
    ).toBeUndefined();
  });

  it('keeps the artboard and unlinks it when the task is deleted', async () => {
    const artboard = await create(personal, 'task_art_1');
    await serverDB.delete(tasks).where(eq(tasks.id, 'task_art_1'));

    expect(await personal.findById(artboard.id)).toMatchObject({ taskId: null });
    expect(
      await serverDB.select().from(artboardPages).where(eq(artboardPages.artboardId, artboard.id)),
    ).toHaveLength(1);
  });

  it('denies another workspace member every private-task artboard read and write', async () => {
    const artboard = await create(inWorkspace, 'task_art_ws');
    const member = new ArtboardModel(serverDB, otherUserId, workspaceId);
    await serverDB
      .update(tasks)
      .set({ visibility: 'private' })
      .where(eq(tasks.id, artboard.taskId!));

    expect(await member.findById(artboard.id)).toBeUndefined();
    expect(await member.listByTaskId(artboard.taskId!)).toEqual([]);
    expect(await member.getRevision(artboard.id)).toBeUndefined();
    expect(await member.listByProject('prj_art')).toEqual([]);
    await expect(
      member.update(artboard.id, { expectedRevision: 1, title: 'Changed' }),
    ).rejects.toThrow();
    expect(await inWorkspace.findById(artboard.id)).toMatchObject({
      revision: 1,
      title: artboard.title,
    });
  });

  it('follows parent visibility changes and excludes trashed parents', async () => {
    const artboard = await create(inWorkspace, 'task_art_ws');
    const member = new ArtboardModel(serverDB, otherUserId, workspaceId);
    await serverDB
      .update(tasks)
      .set({ visibility: 'public' })
      .where(eq(tasks.id, artboard.taskId!));

    expect(await member.findById(artboard.id)).toMatchObject({ id: artboard.id });
    await member.update(artboard.id, { expectedRevision: 1, title: 'Shared edit' });
    await serverDB.update(tasks).set({ isDeleted: true }).where(eq(tasks.id, artboard.taskId!));

    expect(await inWorkspace.findById(artboard.id)).toBeUndefined();
    expect(await inWorkspace.listByProject('prj_art')).toEqual([]);
    await expect(
      inWorkspace.update(artboard.id, { expectedRevision: 2, title: 'Trash edit' }),
    ).rejects.toThrow();
  });
});
