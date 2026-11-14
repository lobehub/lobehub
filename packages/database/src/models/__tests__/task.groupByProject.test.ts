// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { projects, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-group-project-user';
const workspaceId = 'task-group-project-ws';

const tasks = new TaskModel(serverDB, userId, workspaceId);

const seedProject = async (id: string) => {
  await serverDB.insert(projects).values({ id, name: id, slug: id, userId, workspaceId });
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
});

describe('task board grouped by project', () => {
  it('returns a column per project holding tasks, plus "No project"', async () => {
    await seedProject('proj_a');
    await seedProject('proj_empty');
    const inProject = await tasks.create({ instruction: 'x', name: 'a', projectId: 'proj_a' });
    const without = await tasks.create({ instruction: 'x', name: 'b' });

    const groups = await tasks.groupList({ groupBy: 'project' });
    const byKey = Object.fromEntries(groups.map((group) => [group.key, group]));

    expect(Object.keys(byKey).sort()).toEqual(['project:none', 'project:proj_a']);
    expect(byKey['project:proj_a']).toMatchObject({ projectId: 'proj_a', total: 1 });
    expect(byKey['project:proj_a'].tasks.map((task) => task.id)).toEqual([inProject.id]);
    expect(byKey['project:none']).toMatchObject({ projectId: null, total: 1 });
    expect(byKey['project:none'].tasks.map((task) => task.id)).toEqual([without.id]);
  });

  it('keeps an empty "No project" column as a drop target', async () => {
    await seedProject('proj_a');
    await tasks.create({ instruction: 'x', name: 'a', projectId: 'proj_a' });

    const groups = await tasks.groupList({ groupBy: 'project' });

    expect(groups.find((group) => group.key === 'project:none')).toMatchObject({
      projectId: null,
      tasks: [],
      total: 0,
    });
  });

  it('honours the base filters and reports no project field on other boards', async () => {
    await seedProject('proj_a');
    await tasks.create({ instruction: 'x', name: 'a', projectId: 'proj_a', priority: 1 });

    const filtered = await tasks.groupList({ excludeStatuses: ['backlog'], groupBy: 'project' });
    expect(filtered.every((group) => group.tasks.length === 0)).toBe(true);

    const byPriority = await tasks.groupList({ groupBy: 'priority' });
    expect(byPriority.every((group) => !('projectId' in group))).toBe(true);
  });
});
