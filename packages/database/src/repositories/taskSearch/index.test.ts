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

  it('finds a task by a phrase in its instruction and shows the matched passage', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({
      instruction: [
        '![image.png](https://example.com/f/file_1)',
        '',
        'The **resource drive** toolbar has a batch-actions button that does nothing when clicked, so files cannot be moved.',
      ].join('\n'),
      name: 'Drive bug',
    });

    const results = await new TaskSearchRepo(serverDB, userId).search({ query: 'Does Nothing' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: task.id, relevance: 5, title: 'Drive bug' });
    expect(results[0].description).toBe(
      '…toolbar has a batch-actions button that does nothing when clicked, so files cannot be moved.',
    );
  });

  it('finds a task by its description and keeps the description as subtitle', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({
      description: 'Customer escalation from Acme',
      instruction: 'Investigate the report',
      name: 'Escalation',
    });

    const [result] = await new TaskSearchRepo(serverDB, userId).search({ query: 'acme' });

    expect(result).toMatchObject({
      description: 'Customer escalation from Acme',
      id: task.id,
      relevance: 5,
    });
  });

  it('shows the matched passage instead of a description without the term', async () => {
    const model = new TaskModel(serverDB, userId);
    await model.create({ description: 'Short summary', instruction: 'Refactor widget', name: 'X' });

    const [result] = await new TaskSearchRepo(serverDB, userId).search({ query: 'widget' });

    expect(result.description).toBe('Refactor widget');
  });

  it('ranks name matches ahead of content-only matches', async () => {
    const model = new TaskModel(serverDB, userId);
    await model.create({ instruction: 'Mention payments in the body', name: 'Body only' });
    await model.create({ instruction: 'Unrelated', name: 'Fix payments retry' });

    const results = await new TaskSearchRepo(serverDB, userId).search({ query: 'payments' });

    expect(results.map((r) => [r.title, r.relevance])).toEqual([
      ['Fix payments retry', 4],
      ['Body only', 5],
    ]);
  });

  it('falls back to the opening text when the match is inside stripped markdown', async () => {
    const model = new TaskModel(serverDB, userId);
    await model.create({
      instruction: '![shot](https://example.com/f/file_zzz)\n\nSee the screenshot',
      name: 'Shot',
    });

    const [result] = await new TaskSearchRepo(serverDB, userId).search({ query: 'file_zzz' });

    expect(result.description).toBe('See the screenshot');
  });

  it.each(['retry_count', 'C#'])(
    'keeps literal punctuation such as %s in the matched passage',
    async (query) => {
      const model = new TaskModel(serverDB, userId);
      await model.create({
        instruction: `${'Background context that pushes the match past the opening. '.repeat(3)}Then rename ${query} in the worker.`,
        name: 'Punctuation',
      });

      const [result] = await new TaskSearchRepo(serverDB, userId).search({ query });

      expect(result.description).toContain(`rename ${query} in the worker.`);
      expect(result.description?.startsWith('…')).toBe(true);
    },
  );

  it('finds a passage across stripped markdown and drops heading markers', async () => {
    const model = new TaskModel(serverDB, userId);
    await model.create({
      instruction: '## Steps\n\nClick the **batch** button',
      name: 'Markdown',
    });

    const repo = new TaskSearchRepo(serverDB, userId);
    const [byHeading] = await repo.search({ query: 'Steps' });
    expect(byHeading.description).toBe('Steps Click the batch button');

    const [byRawMarkdown] = await repo.search({ query: '**batch** button' });
    expect(byRawMarkdown.description).toBe('Steps Click the batch button');
  });

  it('treats LIKE wildcards in the content literally', async () => {
    const model = new TaskModel(serverDB, userId);
    await model.create({ instruction: 'Coverage must reach 100%', name: 'A' });
    await model.create({ instruction: 'Coverage must reach 1000 lines', name: 'B' });

    const results = await new TaskSearchRepo(serverDB, userId).search({ query: '100%' });

    expect(results.map((r) => r.title)).toEqual(['A']);
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
