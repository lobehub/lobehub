// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { TrashModel } from '@/database/models/trash';
import {
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  trashItems,
  users,
  workspaceAuditLogs,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TrashService } from '../index';

const accessMocks = vi.hoisted(() => ({ restrictedKnowledgeBaseIds: [] as string[] }));
const fileServiceMocks = vi.hoisted(() => ({ deleteFiles: vi.fn() }));
const notificationMocks = vi.hoisted(() => ({ notifyResourceTrashMutation: vi.fn() }));
const workflowMocks = vi.hoisted(() => ({ triggerTrashPurge: vi.fn() }));

vi.mock('@/server/services/knowledgeBaseAccess', () => ({
  getRestrictedKnowledgeBaseIds: vi.fn(async () => accessMocks.restrictedKnowledgeBaseIds),
}));

vi.mock('@/business/server/resource/notifyTrashMutation', () => notificationMocks);
vi.mock('@/server/workflows/trash', () => workflowMocks);

vi.mock('@/server/services/file', () => ({
  FileService: class {
    deleteFile = vi.fn();
    deleteFiles = fileServiceMocks.deleteFiles;
  },
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'trash-service-user';
const otherUserId = 'trash-service-other';

let service: TrashService;
let documentModel: DocumentModel;
let fileModel: FileModel;
let knowledgeBaseModel: KnowledgeBaseModel;
let trashModel: TrashModel;

beforeEach(async () => {
  vi.clearAllMocks();
  accessMocks.restrictedKnowledgeBaseIds = [];
  workflowMocks.triggerTrashPurge.mockResolvedValue(true);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  service = new TrashService(serverDB, userId);
  documentModel = new DocumentModel(serverDB, userId);
  fileModel = new FileModel(serverDB, userId);
  knowledgeBaseModel = new KnowledgeBaseModel(serverDB, userId);
  trashModel = new TrashModel(serverDB, userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users);
});

describe('TrashService', () => {
  describe('resources', () => {
    it('audits delete and restore in the transaction and notifies the original creator', async () => {
      const workspaceId = 'trash-audit-workspace';
      await serverDB
        .insert(workspaces)
        .values({ id: workspaceId, name: 'Audit', primaryOwnerId: userId, slug: workspaceId });
      const creatorModel = new FileModel(serverDB, userId, workspaceId);
      const file = await creatorModel.create({
        fileType: 'text/plain',
        name: 'shared.txt',
        size: 4,
        url: 'files/shared.txt',
        visibility: 'public',
      });
      const actorService = new TrashService(serverDB, otherUserId, workspaceId);

      const [root] = await actorService.trashFiles([file.id]);
      await actorService.restore([root.id]);

      const audits = await serverDB
        .select()
        .from(workspaceAuditLogs)
        .where(eq(workspaceAuditLogs.resourceId, file.id));
      expect(audits.map((audit) => audit.action)).toEqual([
        'resource.deleted',
        'resource.restored',
      ]);
      expect(audits[0]).toMatchObject({
        resourceType: 'file',
        userId: otherUserId,
        workspaceId,
      });
      expect(audits[0].metadata).toMatchObject({
        actorUserId: otherUserId,
        creatorUserId: userId,
        parentId: null,
        resourceTitle: 'shared.txt',
        trashItemId: root.id,
      });
      expect((audits[0].metadata as Record<string, unknown>).batchOperationId).toEqual(
        expect.any(String),
      );
      expect(notificationMocks.notifyResourceTrashMutation).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          actorUserId: otherUserId,
          event: 'deleted',
          recipientUserId: userId,
          trashItemId: root.id,
        }),
      );
      expect(notificationMocks.notifyResourceTrashMutation).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ event: 'restored', recipientUserId: userId }),
      );
    });

    it('rolls back the soft delete when the mandatory audit write fails', async () => {
      const workspaceId = 'trash-audit-rollback-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Audit rollback',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const creatorModel = new FileModel(serverDB, userId, workspaceId);
      const file = await creatorModel.create({
        fileType: 'text/plain',
        name: 'must-stay.txt',
        size: 4,
        url: 'files/must-stay.txt',
        visibility: 'public',
      });
      await serverDB.execute(
        sql`ALTER TABLE workspace_audit_logs RENAME TO workspace_audit_logs_unavailable`,
      );
      try {
        await expect(
          new TrashService(serverDB, otherUserId, workspaceId).trashFiles([file.id]),
        ).rejects.toThrow();
      } finally {
        await serverDB.execute(
          sql`ALTER TABLE workspace_audit_logs_unavailable RENAME TO workspace_audit_logs`,
        );
      }

      expect(await creatorModel.findById(file.id)).toMatchObject({ id: file.id });
      expect(
        await new TrashModel(serverDB, userId, workspaceId).findByResource('file', file.id),
      ).toBeUndefined();
      expect(notificationMocks.notifyResourceTrashMutation).not.toHaveBeenCalled();
    });

    it('hides restricted libraries and their linked resources from list and counts', async () => {
      const workspaceId = 'trash-restricted-workspace';
      await serverDB
        .insert(workspaces)
        .values({ id: workspaceId, name: 'Restricted', primaryOwnerId: userId, slug: workspaceId });
      await serverDB.insert(knowledgeBases).values([
        { id: 'kb_open', name: 'Open', userId, visibility: 'public', workspaceId },
        { id: 'kb_restricted', name: 'Restricted', userId, visibility: 'public', workspaceId },
      ]);
      await serverDB.insert(files).values({
        fileType: 'text/plain',
        id: 'file_restricted',
        name: 'secret.txt',
        size: 1,
        url: 'files/secret.txt',
        userId,
        visibility: 'public',
        workspaceId,
      });
      await serverDB.insert(knowledgeBaseFiles).values({
        fileId: 'file_restricted',
        knowledgeBaseId: 'kb_restricted',
        userId,
        workspaceId,
      });
      await serverDB.insert(documents).values({
        fileType: 'custom/page',
        id: 'docs_restricted',
        knowledgeBaseId: 'kb_restricted',
        source: '',
        sourceType: 'api',
        title: 'Secret page',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
        visibility: 'public',
        workspaceId,
      });

      const registry = new TrashModel(serverDB, userId, workspaceId);
      await registry.register({
        deletedAt: new Date('2026-08-01T00:00:00Z'),
        root: { resourceId: 'kb_open', resourceType: 'knowledgeBase', title: 'Open' },
      });
      await registry.register({
        deletedAt: new Date('2026-08-02T00:00:00Z'),
        root: {
          resourceId: 'kb_restricted',
          resourceType: 'knowledgeBase',
          title: 'Restricted',
        },
      });
      await registry.register({
        deletedAt: new Date('2026-08-03T00:00:00Z'),
        root: { resourceId: 'file_restricted', resourceType: 'file', title: 'secret.txt' },
      });
      await registry.register({
        deletedAt: new Date('2026-08-04T00:00:00Z'),
        root: { resourceId: 'docs_restricted', resourceType: 'document', title: 'Secret page' },
      });
      accessMocks.restrictedKnowledgeBaseIds = ['kb_restricted'];

      const workspaceService = new TrashService(serverDB, otherUserId, workspaceId);
      expect((await workspaceService.list()).items.map((item) => item.resourceId)).toEqual([
        'kb_open',
      ]);
      expect(await workspaceService.countByType()).toEqual({ knowledgeBase: 1 });
      const allRoots = await registry.list({ limit: 20 });
      expect(
        (await workspaceService.findByIds(allRoots.items.map((item) => item.id))).map(
          (item) => item.resourceId,
        ),
      ).toEqual(['kb_open']);

      expect(await workspaceService.emptyTrash()).toEqual({ scheduled: 1 });
      expect(
        (await registry.list({ limit: 20 })).items.map((item) => item.resourceId).sort(),
      ).toEqual(['docs_restricted', 'file_restricted', 'kb_restricted']);
    });

    it('restores a file with its mirror document and knowledge-base association intact', async () => {
      const knowledgeBase = await knowledgeBaseModel.create({ name: 'Research' });
      const { id: fileId } = await fileModel.create({
        fileType: 'text/plain',
        knowledgeBaseId: knowledgeBase.id,
        name: 'notes.txt',
        size: 42,
        url: 'files/notes.txt',
      });
      const mirror = await documentModel.create({
        fileId,
        fileType: 'text/plain',
        source: 'files/notes.txt',
        sourceType: 'file',
        title: 'notes.txt',
        totalCharCount: 0,
        totalLineCount: 0,
      });

      const [root] = await service.trashFiles([fileId]);

      expect(root).toMatchObject({ resourceId: fileId, resourceType: 'file' });
      expect(root.expiresAt.getTime() - root.deletedAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
      expect(await fileModel.findById(fileId)).toBeUndefined();
      expect(await documentModel.findById(mirror.id)).toBeUndefined();
      expect(
        await serverDB
          .select()
          .from(knowledgeBaseFiles)
          .where(eq(knowledgeBaseFiles.fileId, fileId)),
      ).toHaveLength(1);

      const outcome = await service.restore([root.id]);

      expect(outcome.failed).toEqual([]);
      expect(await fileModel.findById(fileId)).toMatchObject({ id: fileId });
      expect(await documentModel.findById(mirror.id)).toMatchObject({ fileId, id: mirror.id });
      expect(
        await serverDB
          .select()
          .from(knowledgeBaseFiles)
          .where(eq(knowledgeBaseFiles.fileId, fileId)),
      ).toHaveLength(1);
    });

    it('restores a folder subtree and every anchored file without changing parent links', async () => {
      const folder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Root folder',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const child = await documentModel.create({
        fileType: 'custom/page',
        parentId: folder.id,
        source: '',
        sourceType: 'api',
        title: 'Child page',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const { id: fileId } = await fileModel.create({
        fileType: 'text/plain',
        name: 'inside.txt',
        parentId: folder.id,
        size: 12,
        url: 'files/inside.txt',
      });

      const [root] = await service.trashDocuments([folder.id]);

      expect(await documentModel.findById(folder.id)).toBeUndefined();
      expect(await documentModel.findById(child.id)).toBeUndefined();
      expect(await fileModel.findById(fileId)).toBeUndefined();
      expect(
        (await trashModel.findChildren(root.id)).map((item) => item.resourceId).sort(),
      ).toEqual([child.id, fileId].sort());

      await service.restore([root.id]);

      expect(await documentModel.findById(child.id)).toMatchObject({ parentId: folder.id });
      expect(await fileModel.findById(fileId)).toMatchObject({ parentId: folder.id });
    });

    it("keeps another member's private subtree reachable when trashing its public parent", async () => {
      const workspaceId = 'trash-private-descendant-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Private descendant',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const ownerModel = new DocumentModel(serverDB, userId, workspaceId);
      const memberModel = new DocumentModel(serverDB, otherUserId, workspaceId);
      const publicFolder = await ownerModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Shared folder',
        totalCharCount: 0,
        totalLineCount: 0,
        visibility: 'public',
      });
      const privateFolder = await memberModel.create({
        fileType: 'custom/folder',
        parentId: publicFolder.id,
        source: '',
        sourceType: 'api',
        title: 'Private folder',
        totalCharCount: 0,
        totalLineCount: 0,
      });

      const [root] = await new TrashService(serverDB, userId, workspaceId).trashDocuments([
        publicFolder.id,
      ]);

      expect(await ownerModel.findById(publicFolder.id)).toBeUndefined();
      expect(await memberModel.findById(privateFolder.id)).toMatchObject({ parentId: null });
      expect(await new TrashModel(serverDB, userId, workspaceId).findChildren(root.id)).toEqual([]);
    });

    it('keeps knowledge-base membership and content live until purge, then removes exclusive files', async () => {
      const knowledgeBase = await knowledgeBaseModel.create({ name: 'Library' });
      const { id: fileId } = await fileModel.create({
        fileType: 'text/plain',
        knowledgeBaseId: knowledgeBase.id,
        name: 'source.txt',
        size: 9,
        url: 'files/source.txt',
      });

      const [root] = await service.trashKnowledgeBases([knowledgeBase.id]);

      expect(await knowledgeBaseModel.findById(knowledgeBase.id)).toBeUndefined();
      expect(await fileModel.findById(fileId)).toBeTruthy();
      expect(
        await serverDB
          .select()
          .from(knowledgeBaseFiles)
          .where(eq(knowledgeBaseFiles.fileId, fileId)),
      ).toHaveLength(1);

      await service.restore([root.id]);
      expect(await knowledgeBaseModel.findById(knowledgeBase.id)).toBeTruthy();
      expect(
        await serverDB
          .select()
          .from(knowledgeBaseFiles)
          .where(eq(knowledgeBaseFiles.fileId, fileId)),
      ).toHaveLength(1);

      const [secondRoot] = await service.trashKnowledgeBases([knowledgeBase.id]);
      await service.purge([secondRoot.id]);
      expect(
        await serverDB.select().from(knowledgeBases).where(eq(knowledgeBases.id, knowledgeBase.id)),
      ).toHaveLength(0);
      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toHaveLength(0);
    });

    it('refuses to restore a child document while its parent folder is still trashed', async () => {
      const folder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Parent',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const child = await documentModel.create({
        fileType: 'custom/page',
        parentId: folder.id,
        source: '',
        sourceType: 'api',
        title: 'Child',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const [childRoot] = await service.trashDocuments([child.id]);
      await service.trashDocuments([folder.id]);

      const outcome = await service.restore([childRoot.id]);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: childRoot.id }]);
      expect(await documentModel.findById(child.id)).toBeUndefined();
    });

    it('purges a trashed file only when explicitly requested', async () => {
      const { id: fileId } = await fileModel.create({
        fileType: 'text/plain',
        name: 'purge.txt',
        size: 3,
        url: 'files/purge.txt',
      });
      const [root] = await service.trashFiles([fileId]);
      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toHaveLength(1);

      await service.purge([root.id]);

      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toHaveLength(0);
      expect(
        await serverDB.select().from(trashItems).where(eq(trashItems.id, root.id)),
      ).toHaveLength(0);
    });

    it('purges every registered document attached to a trashed file', async () => {
      const { id: fileId } = await fileModel.create({
        fileType: 'text/plain',
        name: 'page-source.txt',
        size: 3,
        url: 'files/page-source.txt',
      });
      const document = await documentModel.create({
        fileId,
        fileType: 'custom/page',
        source: '',
        sourceType: 'api',
        title: 'Attached page',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const [root] = await service.trashFiles([fileId]);

      await service.purge([root.id]);

      expect(await serverDB.select().from(documents).where(eq(documents.id, document.id))).toEqual(
        [],
      );
      expect(
        await serverDB.select().from(trashItems).where(eq(trashItems.rootId, root.id)),
      ).toEqual([]);
    });

    it('keeps a trashed file and its registry entry when storage deletion fails', async () => {
      await fileModel.createGlobalFile({
        creator: userId,
        fileType: 'text/plain',
        hashId: 'trash-retryable-hash',
        size: 3,
        url: 'files/retryable.txt',
      });
      const { id: fileId } = await fileModel.create({
        fileHash: 'trash-retryable-hash',
        fileType: 'text/plain',
        name: 'retryable.txt',
        size: 3,
        url: 'files/retryable.txt',
      });
      const [root] = await service.trashFiles([fileId]);
      fileServiceMocks.deleteFiles.mockRejectedValueOnce(new Error('storage unavailable'));

      expect(await service.purge([root.id])).toEqual({
        failed: [{ code: 'purgeFailed', id: root.id }],
        purged: 0,
        purgedIds: [],
      });
      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toHaveLength(1);
      expect(
        await serverDB.select().from(trashItems).where(eq(trashItems.id, root.id)),
      ).toHaveLength(1);

      expect(await service.purge([root.id])).toEqual({
        failed: [],
        purged: 1,
        purgedIds: [root.id],
      });
      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toHaveLength(0);
      expect(fileServiceMocks.deleteFiles).toHaveBeenCalledTimes(2);
    });
  });

  describe('sweep', () => {
    it('purges only expired roots, across users, and prunes stale registry rows', async () => {
      const otherService = new TrashService(serverDB, otherUserId);
      const otherFileModel = new FileModel(serverDB, otherUserId);

      const mine = await fileModel.create({
        fileType: 'text/plain',
        name: 'mine.txt',
        size: 1,
        url: 'files/mine.txt',
      });
      const theirs = await otherFileModel.create({
        fileType: 'text/plain',
        name: 'theirs.txt',
        size: 1,
        url: 'files/theirs.txt',
      });
      const fresh = await fileModel.create({
        fileType: 'text/plain',
        name: 'fresh.txt',
        size: 1,
        url: 'files/fresh.txt',
      });
      const [mineRoot] = await service.trashFiles([mine.id]);
      const [theirsRoot] = await otherService.trashFiles([theirs.id]);
      await service.trashFiles([fresh.id]);
      // backdate two of them past the retention window
      const past = new Date(Date.now() - 1000);
      await serverDB
        .update(trashItems)
        .set({ expiresAt: past })
        .where(eq(trashItems.id, mineRoot.id));
      await serverDB
        .update(trashItems)
        .set({ expiresAt: past })
        .where(eq(trashItems.id, theirsRoot.id));
      // and one orphan registry row whose file vanished through another path
      await trashModel.register({
        deletedAt: new Date(),
        root: { resourceId: 'file_ghost', resourceType: 'file' },
      });

      const outcome = await TrashService.sweepExpired(serverDB);
      expect(outcome).toEqual({ failed: 0, pruned: 1, purged: 2, scanned: 2 });
      expect(await serverDB.select().from(files).where(eq(files.id, mine.id))).toHaveLength(0);
      expect(await serverDB.select().from(files).where(eq(files.id, theirs.id))).toHaveLength(0);
      expect(await serverDB.select().from(files).where(eq(files.id, fresh.id))).toHaveLength(1);
      expect((await service.list()).items.map((i) => i.resourceId)).toEqual([fresh.id]);
    });

    it('emptyTrash atomically queues everything in scope for the bounded sweep', async () => {
      const a = await fileModel.create({
        fileType: 'text/plain',
        name: 'a.txt',
        size: 1,
        url: 'files/a.txt',
      });
      const b = await fileModel.create({
        fileType: 'text/plain',
        name: 'b.txt',
        size: 1,
        url: 'files/b.txt',
      });
      await service.trashFiles([a.id, b.id]);
      const outcome = await service.emptyTrash();
      expect(outcome).toEqual({ scheduled: 2 });
      expect((await service.list()).items).toHaveLength(0);
      expect(await serverDB.select().from(files)).toHaveLength(2);
      expect(workflowMocks.triggerTrashPurge).toHaveBeenCalledOnce();

      expect(await TrashService.sweepExpired(serverDB)).toEqual({
        failed: 0,
        pruned: 0,
        purged: 2,
        scanned: 2,
      });
      expect(await serverDB.select().from(files)).toHaveLength(0);
    });

    it("emptyTrash leaves another member's private workspace items untouched", async () => {
      const workspaceId = 'trash-private-empty-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Private empty trash',
        primaryOwnerId: otherUserId,
        slug: workspaceId,
      });
      const creatorFileModel = new FileModel(serverDB, userId, workspaceId);
      const privateFile = await creatorFileModel.create({
        fileType: 'text/plain',
        name: 'private.txt',
        size: 1,
        url: 'files/private.txt',
        visibility: 'private',
      });
      const publicFile = await creatorFileModel.create({
        fileType: 'text/plain',
        name: 'public.txt',
        size: 1,
        url: 'files/public.txt',
        visibility: 'public',
      });
      const creatorService = new TrashService(serverDB, userId, workspaceId);
      await creatorService.trashFiles([privateFile.id, publicFile.id]);

      const ownerService = new TrashService(serverDB, otherUserId, workspaceId);
      expect(await ownerService.emptyTrash()).toEqual({ scheduled: 1 });

      expect(await serverDB.select().from(files).where(eq(files.id, publicFile.id))).toHaveLength(
        1,
      );
      expect(await serverDB.select().from(files).where(eq(files.id, privateFile.id))).toHaveLength(
        1,
      );
      expect((await creatorService.list()).items.map((item) => item.resourceId)).toEqual([
        privateFile.id,
      ]);

      await TrashService.sweepExpired(serverDB);
      expect(await serverDB.select().from(files).where(eq(files.id, publicFile.id))).toHaveLength(
        0,
      );
      expect(await serverDB.select().from(files).where(eq(files.id, privateFile.id))).toHaveLength(
        1,
      );
    });
  });
});
