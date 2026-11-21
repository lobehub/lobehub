// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { environmentInstances, environments, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { EnvironmentModel } from '../environment';
import { EnvironmentInstanceModel } from '../environmentInstance';

const db: LobeChatDatabase = await getTestDB();

const userId = 'environment-coverage-user';
const environmentModel = new EnvironmentModel(db, userId);
const instanceModel = new EnvironmentInstanceModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  // environments.user_id is `on delete restrict`, so clear this user's rows first.
  const owned = db
    .select({ id: environments.id })
    .from(environments)
    .where(eq(environments.userId, userId));
  await db.delete(environmentInstances).where(inArray(environmentInstances.environmentId, owned));
  await db.delete(environments).where(eq(environments.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('EnvironmentModel coverage', () => {
  it('clears the sources when an update drops the repository url', async () => {
    const env = await environmentModel.save({
      name: 'With repo',
      repositoryUrl: 'https://github.com/lobehub/lobehub',
    });

    const updated = await environmentModel.save({ id: env.id, name: '  No repo  ' });

    expect(updated.name).toBe('No repo');
    expect(updated.configuration.sources).toEqual([]);
  });

  it('pins the requested default branch when one is given', async () => {
    const env = await environmentModel.ensureForRepository({
      defaultBranch: '  develop  ',
      name: 'lobehub/lobehub',
      repositoryUrl: 'https://github.com/lobehub/lobehub',
    });

    expect(env.configuration.sources).toEqual([
      { kind: 'git', ref: 'develop', url: 'https://github.com/lobehub/lobehub' },
    ]);
  });

  it('leaves the configuration untouched when an update does not carry one', async () => {
    const env = await environmentModel.create({
      configuration: { kind: 'code', sources: [] },
      name: 'Untouched',
    });

    const updated = await environmentModel.update(env.id, { name: 'Renamed only' });

    expect(updated).toMatchObject({ id: env.id, name: 'Renamed only' });
    expect(updated?.configuration).toMatchObject({ kind: 'code', sources: [] });
  });

  it('lays out repository sources when an update carries a configuration', async () => {
    const env = await environmentModel.create({
      configuration: { kind: 'code', sources: [] },
      name: 'Relayout',
    });

    const updated = await environmentModel.update(env.id, {
      configuration: {
        kind: 'code',
        sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobehub' }],
      },
    });

    // Stored with the folders it is checked out into, so the form shows what runs.
    expect(updated?.configuration.sources).toEqual([
      expect.objectContaining({ kind: 'git', url: 'https://github.com/lobehub/lobehub' }),
    ]);
  });
});

describe('EnvironmentInstanceModel coverage', () => {
  const makeEnv = async () => {
    const [row] = await db
      .insert(environments)
      .values({ configuration: { sources: [] }, name: `env-${randomUUID()}`, userId })
      .returning();
    return row;
  };

  it('narrows a working-directory lookup to one storage scope', async () => {
    const env = await makeEnv();
    const row = (await instanceModel.create({
      environmentId: env.id,
      kind: 'sandbox',
      name: 'scoped',
      provider: 'e2b',
      providerResourceId: 'cov-resource',
      providerScope: 'cov-scope-a',
      workingDirectory: '/cov/scoped',
    }))!;

    await expect(
      instanceModel.findByWorkingDirectory('/cov/scoped', 'cov-scope-a'),
    ).resolves.toMatchObject({ id: row.id });
    await expect(
      instanceModel.findByWorkingDirectory('/cov/scoped', 'cov-scope-b'),
    ).resolves.toBeUndefined();
  });

  it('finds no storage directories for a binding without provider fields', async () => {
    const env = await makeEnv();
    await instanceModel.create({
      environmentId: env.id,
      kind: 'sandbox',
      name: 'bound',
      provider: 'e2b',
      providerResourceId: 'cov-resource',
      providerScope: 'cov-scope-a',
      workingDirectory: '/cov/bound',
    });

    // A sandbox row always carries non-empty provider fields (environment_instances_binding),
    // so the '' fallback for a missing binding field matches no directory.
    await expect(instanceModel.listStorageDirectories({})).resolves.toEqual([]);
  });
});
