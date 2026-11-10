// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documents,
  files,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_SCRIPT_FILE_TYPE,
  SKILL_VERSION_FILE_TYPE,
  USER_SKILL_SOURCE,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserSkillModel } from '../userSkill';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'user-skill-coverage-user';
const model = new UserSkillModel(serverDB, userId);

/**
 * Inserts a raw skill row the way older / partial writes left it: the model
 * always fills these columns, but they are nullable and must still read back.
 */
const insertRow = async (values: Partial<typeof documents.$inferInsert> & { fileType: string }) => {
  const [row] = await serverDB
    .insert(documents)
    .values({
      source: USER_SKILL_SOURCE,
      sourceType: 'agent',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
      visibility: 'private',
      ...values,
    })
    .returning();
  return row;
};

/** The package a caller publishes alongside every create / revise. */
const archiveFor = (name: string) => ({
  fileHash: `hash-${name}`,
  size: 1,
  url: `skills/${name}.zip`,
});

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(documents).where(eq(documents.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('UserSkillModel coverage', () => {
  describe('reading bare bundles', () => {
    it('falls back to empty strings and version 1 for a bundle with no children or metadata', async () => {
      const bundle = await insertRow({
        content: null,
        description: null,
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: null,
        metadata: null,
        title: null,
      });

      expect(await model.findById(bundle.id)).toEqual({
        content: '',
        createdAt: bundle.createdAt,
        description: '',
        files: [],
        id: bundle.id,
        name: '',
        origin: undefined,
        title: '',
        updatedAt: bundle.updatedAt,
        version: 1,
      });
    });

    it('titles a bundle by its filename when the title is missing', async () => {
      const bundle = await insertRow({
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: 'named-only',
        title: null,
      });

      expect(await model.findById(bundle.id)).toMatchObject({
        name: 'named-only',
        title: 'named-only',
      });
    });

    it('reads a script child with no content or path as empty strings', async () => {
      const bundle = await insertRow({ fileType: SKILL_BUNDLE_FILE_TYPE, filename: 'scripted' });
      await insertRow({
        content: null,
        fileType: SKILL_SCRIPT_FILE_TYPE,
        filename: null,
        metadata: null,
        parentId: bundle.id,
      });

      const skill = await model.findById(bundle.id);

      expect(skill?.files).toEqual([{ content: '', language: undefined, path: '' }]);
    });
  });

  describe('listCatalog', () => {
    it('falls back to empty strings when description, filename and title are missing', async () => {
      const bundle = await insertRow({
        description: null,
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: null,
        title: null,
      });

      expect(await model.listCatalog()).toEqual([
        { description: '', generated: false, id: bundle.id, name: '', title: '' },
      ]);
    });

    it('titles a catalog entry by its filename when the title is missing', async () => {
      const bundle = await insertRow({
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: 'catalog-named',
        title: null,
      });

      expect(await model.listCatalog()).toEqual([
        {
          description: '',
          generated: false,
          id: bundle.id,
          name: 'catalog-named',
          title: 'catalog-named',
        },
      ]);
    });
  });

  describe('findAll', () => {
    it('loads every skill in the library with its body, ordered by name', async () => {
      const zeta = await model.create({
        archive: archiveFor('zeta'),
        content: 'zeta body',
        description: 'z',
        name: 'zeta',
        title: 'Zeta',
      });
      const alpha = await model.create({
        archive: archiveFor('alpha'),
        content: 'alpha body',
        description: 'a',
        files: [{ content: 'echo hi', path: 'scripts/run.sh' }],
        name: 'alpha',
        title: 'Alpha',
      });

      const all = await model.findAll();

      expect(all.map((s) => [s.id, s.name, s.content])).toEqual([
        [alpha.id, 'alpha', 'alpha body'],
        [zeta.id, 'zeta', 'zeta body'],
      ]);
      expect(all[0].files).toEqual([
        { content: 'echo hi', language: undefined, path: 'scripts/run.sh' },
      ]);
    });

    it('returns an empty list when the library is empty', async () => {
      expect(await model.findAll()).toEqual([]);
    });
  });

  describe('findByNames', () => {
    it('returns an empty list for no names without reading the library', async () => {
      await model.create({
        archive: archiveFor('present'),
        content: 'body',
        description: 'd',
        name: 'present',
        title: 'Present',
      });

      expect(await model.findByNames([])).toEqual([]);
    });
  });

  describe('revise', () => {
    it('starts from version 1 when the bundle carries no userSkill metadata', async () => {
      const bundle = await insertRow({
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: 'legacy',
        metadata: null,
      });

      expect(
        await model.revise(bundle.id, {
          archive: archiveFor('legacy-v2'),
          baseVersion: 1,
          content: 'v2 body',
        }),
      ).toBe(2);
      expect(await model.findById(bundle.id)).toMatchObject({ version: 2 });
      expect((await model.listVersions(bundle.id)).map((v) => v.version)).toEqual([2]);
    });

    it('names the published package after an unnamed bundle', async () => {
      const bundle = await insertRow({
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: null,
        metadata: { userSkill: { version: 1 } },
      });

      expect(
        await model.revise(bundle.id, {
          archive: archiveFor('unnamed'),
          baseVersion: 1,
          content: 'v2 body',
        }),
      ).toBe(2);

      const [published] = await serverDB.select().from(files).where(eq(files.parentId, bundle.id));
      expect(published.name).toBe('@2.zip');
    });

    it('reads an archive published before file hashes were stored', async () => {
      const bundle = await insertRow({ fileType: SKILL_BUNDLE_FILE_TYPE, filename: 'hashless' });
      await model.revise(bundle.id, {
        archive: archiveFor('hashless-v2'),
        baseVersion: 1,
        content: 'v2 body',
      });
      // Older rows predate the hash column being filled in by the publisher.
      await serverDB.update(files).set({ fileHash: null }).where(eq(files.parentId, bundle.id));

      const skill = await model.findById(bundle.id);

      expect(skill?.archive).toMatchObject({ fileHash: '' });
    });

    it('tolerates an archive row that lost its metadata', async () => {
      const scoped = new UserSkillModel(serverDB, userId);
      const createdAt = new Date('2026-10-01T00:00:00.000Z');
      // `archiveRows` only selects rows whose metadata carries `skillVersion`, so a
      // metadata-less row is a defensive case the query cannot surface on its own.
      (scoped as any).archiveRows = async () => [
        { createdAt, fileHash: 'h', id: 'archive-1', metadata: null, size: 1, url: 'skills/a.zip' },
      ];

      const [version] = await scoped.listVersions('skill-1');

      expect(version).toMatchObject({ archive: { fileHash: 'h', fileId: 'archive-1' } });
      expect(version.note).toBeUndefined();
      expect(Number.isNaN(version.version)).toBe(true);
    });
  });

  describe('listVersions', () => {
    it('reads a version row with no content or version number as empty / 0', async () => {
      const bundle = await insertRow({ fileType: SKILL_BUNDLE_FILE_TYPE, filename: 'versions' });
      const bare = await insertRow({
        content: null,
        fileType: SKILL_VERSION_FILE_TYPE,
        metadata: null,
        parentId: bundle.id,
      });
      // A version written before archives: its SKILL.md lives on the row itself.
      await insertRow({
        content: 'v2 body',
        fileType: SKILL_VERSION_FILE_TYPE,
        metadata: { version: 2 },
        parentId: bundle.id,
      });

      const versions = await model.listVersions(bundle.id);

      expect(versions.map((v) => [v.id === bare.id, v.version, v.content])).toEqual([
        [true, 0, ''],
        [false, 2, 'v2 body'],
      ]);
    });
  });
});
