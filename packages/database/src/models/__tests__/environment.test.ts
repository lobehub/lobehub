import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { environments, users } from '../../schemas';
import { EnvironmentModel, normalizeProjectRepository } from '../environment';

const db = await getTestDB();
const userId = 'environment-user';
const otherUserId = 'other-environment-user';
const model = new EnvironmentModel(db, userId);
const other = new EnvironmentModel(db, otherUserId);

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});
afterEach(async () => {
  await db.delete(environments);
  await db.delete(users);
});

describe('EnvironmentModel', () => {
  it('seeds the regenerable paths a new environment cannot be useful without', async () => {
    // Without these the sandbox runtime puts node_modules in the snapshot layer,
    // where it counts against an allowance sized for source — the exact thing
    // that makes a small plan unusable for the projects it is sold for.
    const env = await model.create({ name: 'Seeded' });
    expect(env.configuration.excludePaths).toEqual(['node_modules', '.venv', 'target']);
  });

  it('leaves an explicitly chosen list alone, including an empty one', async () => {
    // The field is the author's promise about what can be rebuilt. Once they
    // have decided, the platform must not put its own entries back.
    const chosen = await model.create({
      configuration: { excludePaths: ['dist'] },
      name: 'Chosen',
    });
    expect(chosen.configuration.excludePaths).toEqual(['dist']);

    const cleared = await model.create({
      configuration: { excludePaths: [] },
      name: 'Cleared',
    });
    expect(cleared.configuration.excludePaths).toEqual([]);
  });

  it('creates, lists and updates environments in the owner scope', async () => {
    const env = await model.save({
      name: 'Shared GitHub',
      repositoryUrl: 'git@github.com:lobehub/lobehub.git',
    });
    expect(env.configuration).toEqual({
      sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobehub' }],
    });
    expect(await model.list()).toEqual([expect.objectContaining({ id: env.id })]);
    expect(await other.list()).toEqual([]);
    await expect(other.findEnabledById(env.id)).resolves.toBeUndefined();
    await model.save({
      id: env.id,
      name: 'Updated resource',
      repositoryUrl: 'https://github.com/lobehub/new-repo',
    });
    expect((await model.list())[0].name).toBe('Updated resource');
    await expect(other.save({ id: env.id, name: 'Denied' })).rejects.toThrow('access denied');
  });
});

it('rejects credentials, clone options and non-repository URLs', () => {
  for (const value of [
    'https://token@github.com/a/b',
    'https://github.com/a/b?token=x',
    'https://example.com/a/b',
    'https://github.com/a/b/tree/main',
    '--upload-pack=x',
  ])
    expect(() => normalizeProjectRepository(value)).toThrow();
});
