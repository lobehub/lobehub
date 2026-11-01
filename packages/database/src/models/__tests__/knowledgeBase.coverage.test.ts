// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { KnowledgeBaseModel } from '../knowledgeBase';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'kb-coverage-user';
const memberId = 'kb-coverage-member';
const workspaceId = 'kb-coverage-ws';
const targetWorkspaceId = 'kb-coverage-target-ws';

const insertFile = (id: string, extra: Partial<typeof files.$inferInsert> = {}) =>
  serverDB.insert(files).values({
    fileType: 'application/pdf',
    id,
    name: `${id}.pdf`,
    size: 100,
    url: `https://example.com/${id}.pdf`,
    userId,
    ...extra,
  });

const insertDocument = (id: string, extra: Partial<typeof documents.$inferInsert> = {}) =>
  serverDB.insert(documents).values({
    content: '',
    fileType: 'custom/document',
    id,
    source: '',
    sourceType: 'api',
    title: id,
    totalCharCount: 0,
    totalLineCount: 0,
    userId,
    ...extra,
  });

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: memberId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: workspaceId, primaryOwnerId: userId, slug: workspaceId },
    {
      id: targetWorkspaceId,
      name: targetWorkspaceId,
      primaryOwnerId: userId,
      slug: targetWorkspaceId,
    },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceId, targetWorkspaceId]));
  await serverDB.delete(users).where(inArray(users.id, [userId, memberId]));
});

describe('KnowledgeBaseModel coverage', () => {
  describe('addFilesToKnowledgeBase in a workspace', () => {
    it('moves linked pages and their mirror files into the library visibility', async () => {
      const model = new KnowledgeBaseModel(serverDB, userId, workspaceId);
      const kb = await model.create({ name: 'Public KB', visibility: 'public' });
      await insertFile('kb-cov-mirror-file', { visibility: 'private', workspaceId });
      await insertDocument('docs_kb_cov_page', {
        fileId: 'kb-cov-mirror-file',
        visibility: 'private',
        workspaceId,
      });

      const links = await model.addFilesToKnowledgeBase(kb.id, ['docs_kb_cov_page']);

      expect(links.map((link) => link.fileId)).toEqual(['kb-cov-mirror-file']);
      const page = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'docs_kb_cov_page'),
      });
      const mirror = await serverDB.query.files.findFirst({
        where: eq(files.id, 'kb-cov-mirror-file'),
      });
      expect(page).toMatchObject({ knowledgeBaseId: kb.id, visibility: 'public' });
      expect(mirror?.visibility).toBe('public');
    });
  });

  describe('transferTo', () => {
    it('throws when the knowledge base is not visible to the caller', async () => {
      const model = new KnowledgeBaseModel(serverDB, userId);
      const foreign = await new KnowledgeBaseModel(serverDB, memberId).create({ name: 'Foreign' });

      await expect(model.transferTo(foreign.id, null, userId)).rejects.toThrow(
        'Knowledge base not found',
      );
      await expect(model.transferTo('kb-cov-missing', null, userId)).rejects.toThrow(
        'Knowledge base not found',
      );
    });

    it('applies the target visibility to the library, its files and its pages', async () => {
      const model = new KnowledgeBaseModel(serverDB, userId);
      const kb = await model.create({ name: 'Movable KB' });
      await insertFile('kb-cov-transfer-file');
      await insertDocument('docs_kb_cov_transfer', { knowledgeBaseId: kb.id });
      await model.addFilesToKnowledgeBase(kb.id, ['kb-cov-transfer-file']);

      await model.transferTo(kb.id, targetWorkspaceId, userId, 'public');

      const moved = await serverDB.query.knowledgeBases.findFirst({
        where: eq(knowledgeBases.id, kb.id),
      });
      const file = await serverDB.query.files.findFirst({
        where: eq(files.id, 'kb-cov-transfer-file'),
      });
      const doc = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'docs_kb_cov_transfer'),
      });
      expect(moved).toMatchObject({ visibility: 'public', workspaceId: targetWorkspaceId });
      expect(file).toMatchObject({ visibility: 'public', workspaceId: targetWorkspaceId });
      expect(doc).toMatchObject({ visibility: 'public', workspaceId: targetWorkspaceId });
    });

    it('picks the next free numbered name in the personal scope', async () => {
      const personal = new KnowledgeBaseModel(serverDB, userId);
      await personal.create({ name: 'Dup' });
      await personal.create({ name: 'Dup (1)' });
      const kb = await new KnowledgeBaseModel(serverDB, userId, workspaceId).create({
        name: 'Dup',
      });

      await new KnowledgeBaseModel(serverDB, userId, workspaceId).transferTo(kb.id, null, userId);

      const moved = await serverDB.query.knowledgeBases.findFirst({
        where: eq(knowledgeBases.id, kb.id),
      });
      expect(moved).toMatchObject({ name: 'Dup (2)', workspaceId: null });
    });
  });

  describe('copyToWorkspace', () => {
    it('throws when the knowledge base is not visible to the caller', async () => {
      const model = new KnowledgeBaseModel(serverDB, userId);
      const foreign = await new KnowledgeBaseModel(serverDB, memberId).create({ name: 'Foreign' });

      await expect(model.copyToWorkspace(foreign.id, targetWorkspaceId, userId)).rejects.toThrow(
        'Knowledge base not found',
      );
    });

    it('copies metadata, cyclic parents, outside parents and file-linked pages', async () => {
      const model = new KnowledgeBaseModel(serverDB, userId);
      const kb = await model.create({ name: 'Rich KB' });
      const otherKb = await model.create({ name: 'Other KB' });

      await insertDocument('docs_kb_cov_outside');
      await insertFile('kb-cov-linked-file', {
        metadata: { pages: 3 },
        parentId: 'docs_kb_cov_outside',
      });
      await insertFile('kb-cov-plain-file');
      await insertFile('kb-cov-unlinked-file');
      await model.addFilesToKnowledgeBase(kb.id, ['kb-cov-linked-file', 'kb-cov-plain-file']);

      // Two pages that point at each other: no page is ever "ready", so all are copied at once.
      await insertDocument('docs_kb_cov_a', { knowledgeBaseId: kb.id, metadata: { tag: 'a' } });
      await insertDocument('docs_kb_cov_b', { knowledgeBaseId: kb.id, parentId: 'docs_kb_cov_a' });
      await serverDB
        .update(documents)
        .set({ parentId: 'docs_kb_cov_b' })
        .where(eq(documents.id, 'docs_kb_cov_a'));
      // Mirror page of a linked file that belongs to another library.
      await insertDocument('docs_kb_cov_mirror', {
        fileId: 'kb-cov-linked-file',
        knowledgeBaseId: otherKb.id,
      });
      // Page in this library whose file is not linked to it.
      await insertDocument('docs_kb_cov_detached', {
        fileId: 'kb-cov-unlinked-file',
        knowledgeBaseId: kb.id,
      });

      const result = await model.copyToWorkspace(kb.id, targetWorkspaceId, userId, 'public');

      const copiedKb = await serverDB.query.knowledgeBases.findFirst({
        where: eq(knowledgeBases.id, result.id),
      });
      expect(copiedKb).toMatchObject({ visibility: 'public', workspaceId: targetWorkspaceId });

      const copiedDocs = await serverDB.query.documents.findMany({
        where: eq(documents.workspaceId, targetWorkspaceId),
      });
      const byOrigin = new Map(
        copiedDocs.map((doc) => [(doc.metadata as { duplicatedFrom: string }).duplicatedFrom, doc]),
      );
      expect(byOrigin.size).toBe(4);
      expect(copiedDocs.every((doc) => doc.visibility === 'public')).toBe(true);
      expect(byOrigin.get('docs_kb_cov_a')?.metadata).toEqual({
        duplicatedFrom: 'docs_kb_cov_a',
        tag: 'a',
      });
      // Whichever cycle member is copied first cannot resolve its parent yet; the other can.
      const copyA = byOrigin.get('docs_kb_cov_a');
      const copyB = byOrigin.get('docs_kb_cov_b');
      const cycleParents = [copyA?.parentId, copyB?.parentId];
      expect(cycleParents.filter((parentId) => parentId === null)).toHaveLength(1);
      expect([copyA?.id, copyB?.id]).toContain(cycleParents.find(Boolean));
      expect(byOrigin.get('docs_kb_cov_a')?.knowledgeBaseId).toBe(result.id);
      expect(byOrigin.get('docs_kb_cov_mirror')?.knowledgeBaseId).toBe(otherKb.id);
      expect(byOrigin.get('docs_kb_cov_detached')?.fileId).toBeNull();

      const copiedFiles = await serverDB.query.files.findMany({
        where: eq(files.workspaceId, targetWorkspaceId),
      });
      const fileByOrigin = new Map(
        copiedFiles.map((file) => [
          (file.metadata as { duplicatedFrom: string }).duplicatedFrom,
          file,
        ]),
      );
      expect(fileByOrigin.size).toBe(2);
      expect(fileByOrigin.get('kb-cov-linked-file')).toMatchObject({
        metadata: { duplicatedFrom: 'kb-cov-linked-file', pages: 3 },
        parentId: null,
        visibility: 'public',
      });
      expect(fileByOrigin.get('kb-cov-plain-file')?.parentId).toBeNull();
      expect(byOrigin.get('docs_kb_cov_mirror')?.fileId).toBe(
        fileByOrigin.get('kb-cov-linked-file')?.id,
      );

      const copiedLinks = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, result.id),
      });
      expect(copiedLinks).toHaveLength(2);
    });

    it('skips a link whose file row is gone by the time files are read', async () => {
      const model = new KnowledgeBaseModel(serverDB, userId);
      const kb = await model.create({ name: 'Racy KB' });
      await insertFile('kb-cov-vanishing-file');
      await model.addFilesToKnowledgeBase(kb.id, ['kb-cov-vanishing-file']);

      // The file is deleted concurrently between reading the links and reading the files.
      const proxyDB = createProxyTestDB(serverDB, (query, result) => {
        if (!/from "files" where "files"\."id" in/.test(query)) return result.rows;
        const idIndex = result.fields.findIndex((field) => field.name === 'id');
        return result.rows.filter((row) => row[idIndex] !== 'kb-cov-vanishing-file');
      });
      vi.spyOn(proxyDB, 'transaction').mockImplementation(((cb: (trx: unknown) => unknown) =>
        cb(proxyDB)) as never);

      const result = await new KnowledgeBaseModel(proxyDB, userId).copyToWorkspace(
        kb.id,
        targetWorkspaceId,
        userId,
      );

      const copiedLinks = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, result.id),
      });
      const copiedFiles = await serverDB.query.files.findMany({
        where: eq(files.workspaceId, targetWorkspaceId),
      });
      expect(copiedLinks).toEqual([]);
      expect(copiedFiles).toEqual([]);
    });
  });

  describe('deleteAllWithFiles restricted to creator', () => {
    it('deletes only files linked exclusively to the caller-created libraries', async () => {
      const ownerModel = new KnowledgeBaseModel(serverDB, userId, workspaceId);
      const memberModel = new KnowledgeBaseModel(serverDB, memberId, workspaceId);
      const own = await memberModel.create({ name: 'Member KB', visibility: 'public' });
      const ownerKb = await ownerModel.create({ name: 'Owner KB', visibility: 'public' });
      await insertFile('kb-cov-member-only', { userId: memberId, workspaceId });
      await insertFile('kb-cov-shared', { userId: memberId, workspaceId });
      await memberModel.addFilesToKnowledgeBase(own.id, ['kb-cov-member-only', 'kb-cov-shared']);
      await serverDB.insert(knowledgeBaseFiles).values({
        fileId: 'kb-cov-shared',
        knowledgeBaseId: ownerKb.id,
        userId,
        workspaceId,
      });

      const result = await memberModel.deleteAllWithFiles(false, { restrictToCreator: true });

      expect(result.deletedFiles).toEqual([]);
      const remainingFiles = await serverDB.query.files.findMany({
        where: inArray(files.id, ['kb-cov-member-only', 'kb-cov-shared']),
      });
      expect(remainingFiles.map((file) => file.id)).toEqual(['kb-cov-shared']);
      const remainingKbs = await serverDB.query.knowledgeBases.findMany({
        where: eq(knowledgeBases.workspaceId, workspaceId),
      });
      expect(remainingKbs.map((kb) => kb.id)).toEqual([ownerKb.id]);
    });
  });
});
