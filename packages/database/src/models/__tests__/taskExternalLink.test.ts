// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskExternalLinkModel } from '../taskExternalLink';

const db: LobeChatDatabase = await getTestDB();

const userId = 'task-external-link-user';
const otherUserId = 'task-external-link-other';
const workspaceId = 'task-external-link-ws';

const link = (taskId: string, externalId = 'issue-1') => ({
  externalContainerId: 'team-1',
  externalId,
  externalIdentifier: 'ENG-1',
  externalUrl: 'https://linear.app/acme/issue/ENG-1',
  provider: 'linear' as const,
  syncedHash: 'hash',
  taskId,
});

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
});

describe('TaskExternalLinkModel', () => {
  it('maps an external item to at most one task per scope', async () => {
    const model = new TaskExternalLinkModel(db, userId);
    const tasks = new TaskModel(db, userId);
    const first = await tasks.create({ instruction: 'one' });
    const second = await tasks.create({ instruction: 'two' });

    await model.create(link(first.id));

    await expect(model.create(link(second.id))).rejects.toThrow();
  });

  it('keeps personal and workspace scopes apart', async () => {
    const personal = new TaskExternalLinkModel(db, userId);
    const shared = new TaskExternalLinkModel(db, userId, workspaceId);
    const personalTask = await new TaskModel(db, userId).create({ instruction: 'mine' });
    const sharedTask = await new TaskModel(db, userId, workspaceId).create({
      instruction: 'ours',
    });

    await personal.create(link(personalTask.id));
    await shared.create(link(sharedTask.id));

    const [mine] = await personal.findByExternalIds('linear', ['issue-1']);
    const [ours] = await shared.findByExternalIds('linear', ['issue-1']);
    expect(mine.taskId).toBe(personalTask.id);
    expect(mine.taskIdentifier).toBe(personalTask.identifier);
    expect(ours.taskId).toBe(sharedTask.id);
    expect(
      await new TaskExternalLinkModel(db, otherUserId).findByExternalIds('linear', ['issue-1']),
    ).toEqual([]);
    expect(await shared.findByContainer('linear', 'team-1')).toHaveLength(1);
  });
});
