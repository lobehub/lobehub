// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskExternalLinkModel } from '../taskExternalLink';

const db: LobeChatDatabase = await getTestDB();

const userId = 'task-ext-link-cov-user';
const otherUserId = 'task-ext-link-cov-other';
const workspaceId = 'task-ext-link-cov-ws';

const link = (taskId: string, externalId = 'issue-cov-1') => ({
  externalContainerId: 'team-cov',
  externalId,
  externalIdentifier: 'ENG-1',
  externalUrl: 'https://linear.app/acme/issue/ENG-1',
  provider: 'linear' as const,
  syncedHash: 'hash-1',
  taskId,
});

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  // Tasks and links cascade with their owner and workspace.
  await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('TaskExternalLinkModel coverage', () => {
  it('returns no links for an empty id list without querying', async () => {
    const model = new TaskExternalLinkModel(db, userId);
    const task = await new TaskModel(db, userId).create({ instruction: 'one' });
    await model.create(link(task.id));

    expect(await model.findByExternalIds('linear', [])).toEqual([]);
  });

  it('finds the link of a task only inside its own scope', async () => {
    const personal = new TaskExternalLinkModel(db, userId);
    const shared = new TaskExternalLinkModel(db, userId, workspaceId);
    const personalTask = await new TaskModel(db, userId).create({ instruction: 'mine' });
    const sharedTask = await new TaskModel(db, userId, workspaceId).create({
      instruction: 'ours',
    });
    const mine = await personal.create(link(personalTask.id));
    const ours = await shared.create(link(sharedTask.id));

    expect(await personal.findByTaskId(personalTask.id)).toMatchObject({
      id: mine.id,
      workspaceId: null,
    });
    expect(await shared.findByTaskId(sharedTask.id)).toMatchObject({ id: ours.id, workspaceId });
    // The personal scope never sees a workspace link, and the reverse.
    expect(await personal.findByTaskId(sharedTask.id)).toBeNull();
    expect(await shared.findByTaskId(personalTask.id)).toBeNull();
    expect(
      await new TaskExternalLinkModel(db, otherUserId).findByTaskId(personalTask.id),
    ).toBeNull();
  });

  it('updates a link in scope and stamps the sync time', async () => {
    const model = new TaskExternalLinkModel(db, userId);
    const task = await new TaskModel(db, userId).create({ instruction: 'one' });
    const lastSyncedAt = new Date('2026-01-01T00:00:00.000Z');
    const created = await model.create({ ...link(task.id), lastSyncedAt });
    const externalUpdatedAt = new Date('2026-01-02T03:04:05.000Z');

    await model.update(created.id, {
      externalIdentifier: 'ENG-2',
      externalUpdatedAt,
      syncedHash: 'hash-2',
    });

    const updated = await model.findByTaskId(task.id);
    expect(updated).toMatchObject({
      externalIdentifier: 'ENG-2',
      externalUpdatedAt,
      id: created.id,
      syncedHash: 'hash-2',
    });
    expect(updated!.lastSyncedAt.getTime()).toBeGreaterThan(lastSyncedAt.getTime());
  });

  it('leaves a link outside the caller scope untouched on update', async () => {
    const personal = new TaskExternalLinkModel(db, userId);
    const task = await new TaskModel(db, userId).create({ instruction: 'one' });
    const created = await personal.create(link(task.id));

    await new TaskExternalLinkModel(db, otherUserId).update(created.id, { syncedHash: 'other' });
    await new TaskExternalLinkModel(db, userId, workspaceId).update(created.id, {
      syncedHash: 'ws',
    });

    expect(await personal.findByTaskId(task.id)).toMatchObject({
      lastSyncedAt: created.lastSyncedAt,
      syncedHash: 'hash-1',
    });
  });
});
