// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { TaskModel } from '../../models/task';
import { users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskSearchRepo } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-search-user';
const otherUserId = 'task-search-other-user';
const workspaceId = 'ws_task_search';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const createTasks = async (model: TaskModel, names: (string | null)[]) => {
  const created = [];
  for (const name of names) {
    created.push(await model.create({ instruction: `Do ${name ?? 'it'}`, name }));
  }
  return created;
};

describe('TaskSearchRepo', () => {
  it('finds a task by its identifier, case-insensitively', async () => {
    const model = new TaskModel(serverDB, userId);
    const [, second] = await createTasks(model, ['Write docs', 'Fix login']);

    const results = await new TaskSearchRepo(serverDB, userId).search({ query: 't-2' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: second.id,
      identifier: 'T-2',
      relevance: 1,
      status: 'backlog',
      title: 'Fix login',
      type: 'task',
    });
  });

  it('matches a bare task number against the sequence', async () => {
    const model = new TaskModel(serverDB, userId);
    await createTasks(model, ['First', 'Second', 'Third']);

    const results = await new TaskSearchRepo(serverDB, userId).search({ query: '#3' });

    expect(results.map((r) => r.identifier)).toEqual(['T-3']);
  });

  it('ranks the exact identifier ahead of identifier-prefix matches', async () => {
    const model = new TaskModel(serverDB, userId);
    await createTasks(
      model,
      Array.from({ length: 11 }, (_, i) => `Task ${i + 1}`),
    );

    const results = await new TaskSearchRepo(serverDB, userId).search({ limit: 3, query: 'T-1' });

    expect(results.map((r) => r.identifier)).toEqual(['T-1', 'T-11', 'T-10']);
    expect(results.map((r) => r.relevance)).toEqual([1, 2, 2]);
  });

  it('matches names by prefix before substring and falls back to the identifier as title', async () => {
    const model = new TaskModel(serverDB, userId);
    await createTasks(model, ['Ship the release', 'Release notes', null]);

    const results = await new TaskSearchRepo(serverDB, userId).search({ query: 'release' });

    expect(results.map((r) => [r.title, r.relevance])).toEqual([
      ['Release notes', 3],
      ['Ship the release', 4],
    ]);

    const [untitled] = await new TaskSearchRepo(serverDB, userId).search({ query: 'T-3' });
    expect(untitled.title).toBe('T-3');
  });

  it('treats LIKE wildcards in the query literally', async () => {
    const model = new TaskModel(serverDB, userId);
    await createTasks(model, ['Raise to 100%', 'Raise to 1000']);

    const results = await new TaskSearchRepo(serverDB, userId).search({ query: '100%' });

    expect(results.map((r) => r.title)).toEqual(['Raise to 100%']);
  });

  it('excludes deleted tasks and tasks owned by other users in personal mode', async () => {
    const model = new TaskModel(serverDB, userId);
    const [kept, removed] = await createTasks(model, ['Alpha one', 'Alpha two']);
    await model.delete(removed.id);
    await createTasks(new TaskModel(serverDB, otherUserId), ['Alpha three']);

    const results = await new TaskSearchRepo(serverDB, userId).search({ query: 'alpha' });

    expect(results.map((r) => r.id)).toEqual([kept.id]);
  });

  it("returns public workspace tasks and only the caller's own private ones", async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const ownModel = new TaskModel(serverDB, userId, workspaceId);
    const otherModel = new TaskModel(serverDB, otherUserId, workspaceId);
    const ownPrivate = await ownModel.create({
      instruction: 'x',
      name: 'Beta mine',
      visibility: 'private',
    });
    const otherPublic = await otherModel.create({
      instruction: 'x',
      name: 'Beta shared',
      visibility: 'public',
    });
    await otherModel.create({ instruction: 'x', name: 'Beta hidden', visibility: 'private' });

    const results = await new TaskSearchRepo(serverDB, userId, workspaceId).search({
      query: 'beta',
    });

    expect(results.map((r) => r.id).sort()).toEqual([ownPrivate.id, otherPublic.id].sort());
    expect(await new TaskSearchRepo(serverDB, userId).search({ query: 'beta' })).toEqual([]);
  });

  it('returns nothing for a blank query', async () => {
    await createTasks(new TaskModel(serverDB, userId), ['Anything']);

    expect(await new TaskSearchRepo(serverDB, userId).search({ query: '   ' })).toEqual([]);
  });
});
