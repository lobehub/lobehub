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
