// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  files,
  globalFiles,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-coverage-user';
const otherUserId = 'file-coverage-other';
const workspaceId = 'file-coverage-workspace';
const sharedHash = 'file-coverage-shared-hash';

const fileModel = new FileModel(serverDB, userId);
const otherFileModel = new FileModel(serverDB, otherUserId);
const workspaceFileModel = new FileModel(serverDB, userId, workspaceId);
const otherWorkspaceFileModel = new FileModel(serverDB, otherUserId, workspaceId);

const baseFile = { fileType: 'text/plain', size: 10, url: 'files/coverage.txt' };

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'File Coverage Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  // `global_files.creator` is NOT NULL with `on delete set null`, so drop these rows first.
  await serverDB.delete(files).where(inArray(files.userId, [userId, otherUserId]));
  await serverDB.delete(globalFiles).where(eq(globalFiles.hashId, sharedHash));
  // Workspaces, knowledge bases and their links cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('FileModel coverage', () => {
  describe('delete', () => {
    it('returns undefined and touches nothing when the file is not visible to the caller', async () => {
      const { id } = await otherFileModel.create({ ...baseFile, name: 'theirs.txt' });

      await expect(fileModel.delete(id)).resolves.toBeUndefined();

      const row = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
      expect(row?.userId).toBe(otherUserId);
    });
  });

  describe('countUsage', () => {
    it('returns 0 when the user owns no files (SUM is null)', async () => {
      await expect(fileModel.countUsage()).resolves.toBe(0);
    });
  });

  describe('deleteMany', () => {
    it('returns [] for an empty id list without opening a transaction', async () => {
      const transaction = vi.spyOn(serverDB, 'transaction');

      await expect(fileModel.deleteMany([])).resolves.toEqual([]);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns [] and keeps rows when none of the ids are visible to the caller', async () => {
      const { id } = await otherFileModel.create({ ...baseFile, name: 'theirs.txt' });

      await expect(fileModel.deleteMany([id])).resolves.toEqual([]);

      const row = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
      expect(row).toBeDefined();
    });

    it('only deletes the caller own rows when restrictToCreator is set', async () => {
      const mine = await workspaceFileModel.create({ ...baseFile, name: 'mine.txt' });
      const theirs = await otherWorkspaceFileModel.create({ ...baseFile, name: 'theirs.txt' });
      await serverDB
        .update(files)
        .set({ visibility: 'public' })
        .where(inArray(files.id, [mine.id, theirs.id]));

      await workspaceFileModel.deleteMany([mine.id, theirs.id], true, { restrictToCreator: true });

      const remaining = await serverDB
        .select({ id: files.id })
        .from(files)
        .where(inArray(files.id, [mine.id, theirs.id]));
      expect(remaining).toEqual([{ id: theirs.id }]);
    });

    it('returns [] and keeps the global file while another row still references its hash', async () => {
      await fileModel.createGlobalFile({
        fileType: 'text/plain',
        hashId: sharedHash,
        size: 10,
        url: 'files/shared.txt',
      });
      const first = await fileModel.create({ ...baseFile, fileHash: sharedHash, name: 'a.txt' });
      await fileModel.create({ ...baseFile, fileHash: sharedHash, name: 'b.txt' });

      await expect(fileModel.deleteMany([first.id])).resolves.toEqual([]);

      const global = await serverDB.query.globalFiles.findFirst({
        where: eq(globalFiles.hashId, sharedHash),
      });
      expect(global).toBeDefined();
    });
  });

  describe('query', () => {
    it('filters by visibility', async () => {
      const privateFile = await workspaceFileModel.create({ ...baseFile, name: 'private.txt' });
      const publicFile = await workspaceFileModel.create({ ...baseFile, name: 'public.txt' });
      await serverDB
        .update(files)
        .set({ visibility: 'private' })
        .where(eq(files.id, privateFile.id));
      await serverDB.update(files).set({ visibility: 'public' }).where(eq(files.id, publicFile.id));

      const result = await workspaceFileModel.query({ visibility: 'public' });

      expect(result.map((file) => file.id)).toEqual([publicFile.id]);
    });

    it('drops files linked to an excluded knowledge base in a cross-KB listing', async () => {
      await serverDB.insert(knowledgeBases).values([
        { id: 'file-cov-kb-restricted', name: 'Restricted', userId },
        { id: 'file-cov-kb-open', name: 'Open', userId },
      ]);
      const hidden = await fileModel.create({ ...baseFile, name: 'hidden.txt' });
      const shown = await fileModel.create({ ...baseFile, name: 'shown.txt' });
      await serverDB.insert(knowledgeBaseFiles).values([
        { fileId: hidden.id, knowledgeBaseId: 'file-cov-kb-restricted', userId },
        { fileId: shown.id, knowledgeBaseId: 'file-cov-kb-open', userId },
      ]);

      const result = await fileModel.query({
        excludeKnowledgeBaseIds: ['file-cov-kb-restricted'],
        showFilesInKnowledgeBase: true,
      });

      expect(result.map((file) => file.id)).toEqual([shown.id]);
    });

    it('returns the uploader profile joined from users', async () => {
      await serverDB
        .update(users)
        .set({ avatar: 'avatar.png', fullName: 'File Owner', username: 'file-owner' })
        .where(eq(users.id, userId));
      await fileModel.create({ ...baseFile, name: 'profile.txt' });

      const [row] = await fileModel.query();

      expect(row.uploader).toEqual({
        avatar: 'avatar.png',
        fullName: 'File Owner',
        id: userId,
        username: 'file-owner',
      });
    });
  });

  describe('workspace moves with a target visibility', () => {
    it('transferTo applies the visibility when landing in a workspace', async () => {
      const { id } = await fileModel.create({ ...baseFile, name: 'move.txt' });

      await expect(fileModel.transferTo(id, workspaceId, userId, 'public')).resolves.toEqual({
        fileId: id,
      });

      const row = await serverDB.query.files.findFirst({ where: eq(files.id, id) });
      expect(row).toMatchObject({ visibility: 'public', workspaceId });
    });

    it('copyToWorkspace applies the visibility to the copy', async () => {
      const { id } = await fileModel.create({ ...baseFile, name: 'copy.txt' });

      const { fileId } = await fileModel.copyToWorkspace(id, workspaceId, userId, 'public');

      const row = await serverDB.query.files.findFirst({ where: eq(files.id, fileId) });
      expect(row).toMatchObject({ visibility: 'public', workspaceId });
      expect(row?.metadata).toMatchObject({ duplicatedFrom: id });
    });
  });
});
