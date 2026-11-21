// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentSkillModel } from '../agentSkill';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'askcov-user';
const importUserId = 'askcov-import-user';

describe('AgentSkillModel coverage edges', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delete reports no success when the driver returns a null rowCount', async () => {
    // node-postgres types `rowCount` as `number | null`; a driver result without
    // an affected-row count must not be read as a successful delete.
    const where = vi.fn().mockResolvedValue({ rowCount: null });
    vi.spyOn(serverDB, 'delete').mockReturnValueOnce({ where } as unknown as ReturnType<
      LobeChatDatabase['delete']
    >);

    const model = new AgentSkillModel(serverDB, userId);

    await expect(model.delete('askcov-skill')).resolves.toEqual({ success: false });
    expect(where).toHaveBeenCalledTimes(1);
  });
});

/**
 * GitHub collection import (`#23409`): the importer looks a candidate up by
 * identifier AND by case-insensitive name, serializes its create/rename
 * decisions behind an advisory lock, and replaces an existing row only when the
 * row it read is still the current one.
 */
describe('AgentSkillModel import helpers', () => {
  const importModel = new AgentSkillModel(serverDB, importUserId);

  const seed = async (identifier: string, name: string, updatedAt?: Date) =>
    importModel.create({
      content: '# content',
      description: `${name} description`,
      identifier,
      manifest: { description: `${name} description`, name },
      name,
      source: 'user',
      ...(updatedAt ? { updatedAt } : {}),
    });

  beforeEach(async () => {
    await serverDB.delete(users).where(eq(users.id, importUserId));
    await serverDB.insert(users).values({ id: importUserId });
  });

  afterEach(async () => {
    await serverDB.delete(users).where(eq(users.id, importUserId));
  });

  it('findImportMatches matches either the identifier or a case-insensitive name', async () => {
    await seed('alpha.skill', 'Alpha Skill');
    await seed('beta.skill', 'Beta Skill');

    await expect(
      importModel
        .findImportMatches(['beta.skill'], [])
        .then((rows) => rows.map((r) => r.identifier)),
    ).resolves.toEqual(['beta.skill']);

    // The name arm is case-insensitive: GitHub collections do not agree with
    // the library on capitalization.
    await expect(
      importModel
        .findImportMatches(['unrelated.skill'], ['ALPHA SKILL'])
        .then((rows) => rows.map((r) => r.identifier)),
    ).resolves.toEqual(['alpha.skill']);

    await expect(importModel.findImportMatches(['nope.skill'], ['nope'])).resolves.toEqual([]);
    await expect(importModel.findImportMatches([], [])).resolves.toEqual([]);
  });

  it('findImportMatches never reaches another user’s library', async () => {
    await seed('scoped.skill', 'Scoped Skill');
    const otherModel = new AgentSkillModel(serverDB, 'askcov-import-other');

    await expect(otherModel.findImportMatches(['scoped.skill'], ['Scoped Skill'])).resolves.toEqual(
      [],
    );
  });

  it('withImportLock runs the write inside one transaction and returns its result', async () => {
    const result = await importModel.withImportLock(async (txModel) => {
      expect(txModel).toBeInstanceOf(AgentSkillModel);
      await txModel.create({
        content: '# locked',
        description: 'created under the import lock',
        identifier: 'locked.skill',
        manifest: { description: 'locked', name: 'Locked Skill' },
        name: 'Locked Skill',
        source: 'user',
      });
      return 'done';
    });

    expect(result).toBe('done');
    await expect(importModel.findByIdentifier('locked.skill')).resolves.toBeDefined();
  });

  it('withImportLock scopes the advisory lock to the workspace when one is active', async () => {
    // The lock key differs per scope; the workspace branch must not fall back to
    // the personal `user:` key.
    const workspaceModel = new AgentSkillModel(serverDB, importUserId, 'askcov-import-ws');

    await expect(workspaceModel.withImportLock(async () => 'ws')).resolves.toBe('ws');
  });

  it('replaceImportedSkill only writes when the stored row is still the one read', async () => {
    // Seed an explicitly old timestamp: `replaceImportedSkill` stamps `new Date()`
    // and compares at millisecond precision, so a fixture created "now" could
    // share the first replacement's millisecond and stay fresh — the guard would
    // then let the second write through depending on timing.
    await seed('replace.skill', 'Replace Skill', new Date('2020-01-01T00:00:00.000Z'));
    const existing = await importModel.findByIdentifier('replace.skill');

    const updated = await importModel.replaceImportedSkill(existing!, {
      content: '# v2',
      name: 'Replace Skill v2',
    });
    expect(updated).toMatchObject({ content: '# v2', name: 'Replace Skill v2' });

    // The caller's copy is now stale: the timestamp guard must refuse the write
    // instead of overwriting whatever the other import wrote in between.
    await expect(
      importModel.replaceImportedSkill(existing!, { content: '# stale' }),
    ).resolves.toBeUndefined();
    await expect(importModel.findByIdentifier('replace.skill')).resolves.toMatchObject({
      content: '# v2',
    });
  });
});

/**
 * Rows the Skills page offers for "update from GitHub": anything installed with
 * an `upstream` (a GitHub install), plus market rows that recorded a `sourceUrl`
 * in their manifest (legacy imports). A market row without one, and a
 * user-authored skill, are not GitHub installs.
 */
describe('AgentSkillModel findGitHubInstalls', () => {
  const installUserId = 'askcov-github-installs';
  const model = new AgentSkillModel(serverDB, installUserId);

  const seed = (identifier: string, extra: Record<string, unknown> = {}) =>
    model.create({
      content: '# content',
      description: identifier,
      identifier,
      manifest: {},
      name: identifier,
      source: 'user',
      ...extra,
    });

  beforeEach(async () => {
    await serverDB.delete(users).where(eq(users.id, installUserId));
    await serverDB.insert(users).values({ id: installUserId });
  });

  it('returns GitHub installs only', async () => {
    await seed('gh.upstream', {
      upstream: { owner: 'lobehub', path: 'skills/a/SKILL.md', ref: 'HEAD', repo: 'skills' },
      source: 'market',
    });
    await seed('gh.legacy', {
      manifest: { sourceUrl: 'https://github.com/lobehub/skills/tree/main/skills/b' },
      source: 'market',
    });
    // Neither of these is a GitHub install.
    await seed('market.no-url', { manifest: { description: 'no source url' }, source: 'market' });
    await seed('user.skill');

    const installs = await model.findGitHubInstalls();

    expect(installs.map((skill) => skill.identifier).sort()).toEqual(['gh.legacy', 'gh.upstream']);
    // The full item is returned, so the caller can compare the installed revision.
    expect(installs.find((skill) => skill.identifier === 'gh.upstream')?.upstream).toMatchObject({
      owner: 'lobehub',
      repo: 'skills',
    });
  });

  it('keeps another user’s installs out of the list', async () => {
    await seed('mine.upstream', {
      upstream: { owner: 'lobehub', path: 'skills/a/SKILL.md', ref: 'HEAD', repo: 'skills' },
      source: 'market',
    });

    const other = new AgentSkillModel(serverDB, 'askcov-github-installs-other');
    await serverDB
      .insert(users)
      .values({ id: 'askcov-github-installs-other' })
      .onConflictDoNothing();

    await expect(other.findGitHubInstalls()).resolves.toEqual([]);
    await expect(model.findGitHubInstalls()).resolves.toHaveLength(1);

    await serverDB.delete(users).where(eq(users.id, 'askcov-github-installs-other'));
  });
});
