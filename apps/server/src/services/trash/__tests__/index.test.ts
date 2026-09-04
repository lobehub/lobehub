// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { TrashModel } from '@/database/models/trash';
import {
  agentDocuments,
  agents,
  documents,
  files,
  globalFiles,
  knowledgeBaseFiles,
  knowledgeBases,
  resourcePermissions,
  type TrashItemRow,
  trashItems,
  users,
  workspaceAuditLogs,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { lockDocumentHierarchy } from '@/database/utils/documentHierarchy';

import { purgeFiles } from '../handlers/purgeFiles';
import { orderTrashRestoreRoots, TrashService } from '../index';

const accessMocks = vi.hoisted(() => ({
  liveRestrictedKnowledgeBaseIds: undefined as string[] | undefined,
  restrictedKnowledgeBaseIds: [] as string[],
  trashedRestrictedKnowledgeBaseIds: [] as string[],
}));
const fileServiceMocks = vi.hoisted(() => ({ deleteFiles: vi.fn() }));
const notificationMocks = vi.hoisted(() => ({ notifyResourceTrashMutation: vi.fn() }));
const workflowMocks = vi.hoisted(() => ({ triggerTrashPurge: vi.fn() }));

vi.mock('@/server/services/knowledgeBaseAccess', () => ({
  getRestrictedKnowledgeBasePolicy: vi.fn(async () => ({
    allRestrictedKnowledgeBaseIds: accessMocks.restrictedKnowledgeBaseIds,
    liveRestrictedKnowledgeBaseIds:
      accessMocks.liveRestrictedKnowledgeBaseIds ?? accessMocks.restrictedKnowledgeBaseIds,
    trashedKnowledgeBaseIds: accessMocks.trashedRestrictedKnowledgeBaseIds,
    trashedRestrictedKnowledgeBaseIds: accessMocks.trashedRestrictedKnowledgeBaseIds,
  })),
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
  accessMocks.liveRestrictedKnowledgeBaseIds = undefined;
  accessMocks.restrictedKnowledgeBaseIds = [];
  accessMocks.trashedRestrictedKnowledgeBaseIds = [];
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
    it('serializes a file scope transfer behind trashing and rejects the stale transfer', async () => {
      const targetWorkspaceId = 'trash-file-transfer-target';
      await serverDB.insert(workspaces).values({
        id: targetWorkspaceId,
        name: 'File transfer target',
        primaryOwnerId: userId,
        slug: targetWorkspaceId,
      });
      const file = await fileModel.create({
        fileType: 'text/plain',
        name: 'transfer-race.txt',
        size: 1,
        url: 'files/transfer-race.txt',
      });
      const deletedAt = new Date('2026-09-01T00:00:00Z');
      let trashStamped!: () => void;
      const stamped = new Promise<void>((resolve) => {
        trashStamped = resolve;
      });
      let releaseTrash!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseTrash = resolve;
      });
      const trashPromise = serverDB.transaction(async (tx) => {
        await lockDocumentHierarchy(tx as unknown as LobeChatDatabase, userId);
        await new FileModel(tx as unknown as LobeChatDatabase, userId).softDelete([file.id], {
          deletedAt,
        });
        await new TrashModel(tx as unknown as LobeChatDatabase, userId).register({
          deletedAt,
          root: { resourceId: file.id, resourceType: 'file', title: 'transfer-race.txt' },
        });
        trashStamped();
        await release;
      });
      await stamped;

      let transferSettled = false;
      const transferPromise = fileModel
        .transferTo(file.id, targetWorkspaceId, userId)
        .finally(() => {
          transferSettled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(transferSettled).toBe(false);

      releaseTrash();
      await trashPromise;
      await expect(transferPromise).rejects.toThrow('File not found');
      const [row] = await serverDB.select().from(files).where(eq(files.id, file.id));
      expect(row.workspaceId).toBeNull();
      expect(row.isDeleted).toBe(true);
    });

    it('serializes an agent scope transfer behind document trashing and skips the trashed VFS row', async () => {
      const targetWorkspaceId = 'trash-agent-transfer-target';
      await serverDB.insert(workspaces).values({
        id: targetWorkspaceId,
        name: 'Agent transfer target',
        primaryOwnerId: userId,
        slug: targetWorkspaceId,
      });
      const agentModel = new AgentModel(serverDB, userId);
      const agent = await agentModel.create({ title: 'Transfer race agent' });
      await serverDB.insert(documents).values({
        content: 'skill',
        fileType: 'text/markdown',
        id: 'trash-agent-transfer-document',
        source: `agent-document://${agent.id}/skill.md`,
        sourceType: 'agent',
        title: 'skill.md',
        totalCharCount: 5,
        totalLineCount: 1,
        userId,
      });
      await serverDB.insert(agentDocuments).values({
        agentId: agent.id,
        documentId: 'trash-agent-transfer-document',
        userId,
      });
      const deletedAt = new Date('2026-09-01T00:00:00Z');
      let trashStamped!: () => void;
      const stamped = new Promise<void>((resolve) => {
        trashStamped = resolve;
      });
      let releaseTrash!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseTrash = resolve;
      });
      const trashPromise = serverDB.transaction(async (tx) => {
        await new DocumentModel(tx as unknown as LobeChatDatabase, userId).softDeleteSubtree(
          'trash-agent-transfer-document',
          { deletedAt },
        );
        await new TrashModel(tx as unknown as LobeChatDatabase, userId).register({
          deletedAt,
          root: {
            resourceId: 'trash-agent-transfer-document',
            resourceType: 'document',
            title: 'skill.md',
          },
        });
        trashStamped();
        await release;
      });
      await stamped;

      let transferSettled = false;
      const transferPromise = agentModel
        .transferAgent(agent.id, targetWorkspaceId, userId)
        .finally(() => {
          transferSettled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(transferSettled).toBe(false);

      releaseTrash();
      await trashPromise;
      await expect(transferPromise).resolves.toMatchObject({ agentId: agent.id });

      const [agentRow] = await serverDB.select().from(agents).where(eq(agents.id, agent.id));
      const [document] = await serverDB
        .select()
        .from(documents)
        .where(eq(documents.id, 'trash-agent-transfer-document'));
      const [binding] = await serverDB
        .select()
        .from(agentDocuments)
        .where(eq(agentDocuments.documentId, 'trash-agent-transfer-document'));
      const trashRoot = await trashModel.findByResource(
        'document',
        'trash-agent-transfer-document',
      );
      expect(agentRow.workspaceId).toBe(targetWorkspaceId);
      expect(document.workspaceId).toBeNull();
      expect(document.isDeleted).toBe(true);
      expect(binding.workspaceId).toBeNull();
      expect(trashRoot?.workspaceId).toBeNull();
    });

    it('serializes parent-targeting document and file writes with subtree trashing', async () => {
      const folder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Concurrent parent',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const movableDocument = await documentModel.create({
        fileType: 'custom/page',
        source: '',
        sourceType: 'api',
        title: 'Movable document',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const movableFile = await fileModel.create({
        fileType: 'text/plain',
        name: 'movable.txt',
        size: 1,
        url: 'files/movable.txt',
      });

      let enterCollection!: () => void;
      const collectionEntered = new Promise<void>((resolve) => {
        enterCollection = resolve;
      });
      let releaseCollection!: () => void;
      const collectionRelease = new Promise<void>((resolve) => {
        releaseCollection = resolve;
      });
      const trashPromise = serverDB.transaction(async (tx) => {
        const result = await new DocumentModel(
          tx as unknown as LobeChatDatabase,
          userId,
        ).softDeleteSubtree(folder.id, { deletedAt: new Date() });
        enterCollection();
        await collectionRelease;
        return result;
      });
      await collectionEntered;

      let settled = 0;
      const capture = async (promise: Promise<unknown>) =>
        promise.then(
          (value) => {
            settled += 1;
            return { value };
          },
          (error: unknown) => {
            settled += 1;
            return { error };
          },
        );
      const writes = [
        capture(
          documentModel.create({
            fileType: 'custom/page',
            parentId: folder.id,
            source: '',
            sourceType: 'api',
            title: 'Racing child',
            totalCharCount: 0,
            totalLineCount: 0,
          }),
        ),
        capture(documentModel.update(movableDocument.id, { parentId: folder.id })),
        capture(
          fileModel.create({
            fileType: 'text/plain',
            name: 'racing.txt',
            parentId: folder.id,
            size: 1,
            url: 'files/racing.txt',
          }),
        ),
        capture(fileModel.update(movableFile.id, { parentId: folder.id })),
      ];

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(0);

      releaseCollection();
      await trashPromise;
      const outcomes = await Promise.all(writes);

      expect(outcomes).toEqual(Array.from({ length: 4 }, () => ({ error: expect.any(Error) })));
      for (const outcome of outcomes) {
        expect(String('error' in outcome ? outcome.error : '')).toContain(
          'Parent document not found',
        );
      }
      expect(await documentModel.findById(movableDocument.id)).toMatchObject({ parentId: null });
      expect(await fileModel.findById(movableFile.id)).toMatchObject({ parentId: null });
      expect(
        await serverDB.select().from(documents).where(eq(documents.title, 'Racing child')),
      ).toEqual([]);
      expect(await serverDB.select().from(files).where(eq(files.name, 'racing.txt'))).toEqual([]);
    });

    it('waits for an in-flight file mirror insert and includes it in the trash closure', async () => {
      const file = await fileModel.create({
        fileType: 'text/plain',
        name: 'parsing.txt',
        size: 1,
        url: 'files/parsing.txt',
      });
      let parserLocked!: () => void;
      const parserHasLock = new Promise<void>((resolve) => {
        parserLocked = resolve;
      });
      let releaseParser!: () => void;
      const parserRelease = new Promise<void>((resolve) => {
        releaseParser = resolve;
      });
      const parserPromise = serverDB.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`parseFile:${file.id}`})::bigint)`,
        );
        parserLocked();
        await parserRelease;
        return documentModel.create(
          {
            fileId: file.id,
            fileType: 'custom/document',
            source: 'files/parsing.txt',
            sourceType: 'file',
            title: 'Parsed while trashing',
            totalCharCount: 0,
            totalLineCount: 0,
          },
          tx,
        );
      });
      await parserHasLock;

      let trashSettled = false;
      const trashPromise = service.trashFiles([file.id]).finally(() => {
        trashSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(trashSettled).toBe(false);

      releaseParser();
      const [mirror, [root]] = await Promise.all([parserPromise, trashPromise]);

      expect(await fileModel.findById(file.id)).toBeUndefined();
      expect(await documentModel.findById(mirror.id)).toBeUndefined();
      expect((await trashModel.findChildren(root.id)).map((item) => item.resourceId)).toContain(
        mirror.id,
      );
    });

    it('serializes restore behind an in-flight permanent purge claim', async () => {
      await fileModel.createGlobalFile({
        creator: userId,
        fileType: 'text/plain',
        hashId: 'purge-race-hash',
        size: 1,
        url: 'files/purge-race.txt',
      });
      const file = await fileModel.create({
        fileHash: 'purge-race-hash',
        fileType: 'text/plain',
        name: 'purge-race.txt',
        size: 1,
        url: 'files/purge-race.txt',
      });
      const [root] = await service.trashFiles([file.id]);
      let releaseStorageDelete!: () => void;
      fileServiceMocks.deleteFiles.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseStorageDelete = resolve;
          }),
      );

      const purgePromise = service.purge([root.id]);
      await vi.waitFor(() => expect(fileServiceMocks.deleteFiles).toHaveBeenCalledOnce());

      await expect(service.restore([root.id])).resolves.toEqual({
        failed: [{ code: 'notFound', id: root.id }],
        restored: [],
      });
      expect(await trashModel.findByIdIncludingQueued(root.id)).toMatchObject({
        meta: expect.objectContaining({ purgeClaim: expect.any(Object) }),
      });

      releaseStorageDelete();
      await expect(purgePromise).resolves.toEqual({
        failed: [],
        purged: 1,
        purgedIds: [root.id],
      });
      expect(await serverDB.select().from(files).where(eq(files.id, file.id))).toEqual([]);
      expect(await trashModel.findByIdIncludingQueued(root.id)).toBeUndefined();
    });

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

    it('keeps independent bulk roots separate and collapses overlapping document trees', async () => {
      const firstFile = await fileModel.create({
        fileType: 'text/plain',
        name: 'first.txt',
        size: 1,
        url: 'files/first.txt',
      });
      const secondFile = await fileModel.create({
        fileType: 'text/plain',
        name: 'second.txt',
        size: 1,
        url: 'files/second.txt',
      });

      const fileRoots = await service.trashFiles([firstFile.id, secondFile.id]);
      expect(fileRoots.map((root) => root.resourceId)).toEqual([firstFile.id, secondFile.id]);
      await service.restore(fileRoots.map((root) => root.id));

      const firstMirror = await documentModel.create({
        fileId: firstFile.id,
        fileType: 'text/plain',
        source: 'files/first.txt',
        sourceType: 'file',
        title: 'First mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      await documentModel.create({
        fileId: secondFile.id,
        fileType: 'text/plain',
        parentId: firstMirror.id,
        source: 'files/second.txt',
        sourceType: 'file',
        title: 'Second mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });

      const [connectedRoot, extraConnectedRoot] = await service.trashFiles([
        secondFile.id,
        firstFile.id,
      ]);
      expect(extraConnectedRoot).toBeUndefined();
      expect(connectedRoot.resourceId).toBe(secondFile.id);
      expect(
        (await trashModel.findChildren(connectedRoot.id)).map((item) => item.resourceId),
      ).toEqual(expect.arrayContaining([firstFile.id, firstMirror.id]));
      await service.restore([connectedRoot.id]);

      const folder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Bulk folder',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const child = await documentModel.create({
        fileType: 'custom/page',
        parentId: folder.id,
        source: '',
        sourceType: 'api',
        title: 'Bulk child',
        totalCharCount: 0,
        totalLineCount: 0,
      });

      const [documentRoot, duplicateRoot] = await service.trashDocuments([child.id, folder.id]);
      expect(duplicateRoot).toBeUndefined();
      expect(documentRoot.resourceId).toBe(folder.id);
      expect(await trashModel.findChildren(documentRoot.id)).toEqual([
        expect.objectContaining({ resourceId: child.id, rootId: documentRoot.id }),
      ]);
      await expect(service.restore([documentRoot.id])).resolves.toMatchObject({ failed: [] });
      await expect(documentModel.findById(child.id)).resolves.toMatchObject({
        parentId: folder.id,
      });
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
      const listSpy = vi.spyOn(
        (workspaceService as unknown as { trashModel: TrashModel }).trashModel,
        'list',
      );
      expect((await workspaceService.list()).items.map((item) => item.resourceId)).toEqual([
        'kb_open',
      ]);
      expect(listSpy).toHaveBeenCalledOnce();
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

    it('rejects direct restore and purge of a restricted trashed knowledge base', async () => {
      const workspaceId = 'trash-restricted-mutation-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Restricted mutation',
        primaryOwnerId: otherUserId,
        slug: workspaceId,
      });
      const creatorModel = new KnowledgeBaseModel(serverDB, userId, workspaceId);
      const restricted = await creatorModel.create({
        name: 'Restricted library',
        visibility: 'public',
      });
      const creatorService = new TrashService(serverDB, userId, workspaceId);
      const [root] = await creatorService.trashKnowledgeBases([restricted.id]);
      accessMocks.restrictedKnowledgeBaseIds = [restricted.id];

      const actorService = new TrashService(serverDB, otherUserId, workspaceId);
      await expect(actorService.restore([root.id])).resolves.toEqual({
        failed: [{ code: 'notFound', id: root.id }],
        restored: [],
      });
      await expect(actorService.purge([root.id])).resolves.toEqual({
        failed: [{ code: 'notFound', id: root.id }],
        purged: 0,
        purgedIds: [],
      });

      expect(
        await serverDB
          .select({ isDeleted: knowledgeBases.isDeleted })
          .from(knowledgeBases)
          .where(eq(knowledgeBases.id, restricted.id)),
      ).toEqual([{ isDeleted: true }]);
      expect(await actorService.findByIds([root.id])).toHaveLength(0);
      expect(await new TrashModel(serverDB, userId, workspaceId).findByIds([root.id])).toHaveLength(
        1,
      );
    });

    it('keeps a trashed shared file available through its live open knowledge base', async () => {
      const workspaceId = 'trash-shared-open-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Shared open library',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const creatorKnowledgeBaseModel = new KnowledgeBaseModel(serverDB, userId, workspaceId);
      const creatorFileModel = new FileModel(serverDB, userId, workspaceId);
      const restricted = await creatorKnowledgeBaseModel.create({
        name: 'Restricted library',
        visibility: 'public',
      });
      const open = await creatorKnowledgeBaseModel.create({
        name: 'Open library',
        visibility: 'public',
      });
      const file = await creatorFileModel.create({
        fileType: 'text/plain',
        name: 'shared.txt',
        size: 1,
        url: 'files/shared-open.txt',
        visibility: 'public',
      });
      await creatorKnowledgeBaseModel.addFilesToKnowledgeBase(restricted.id, [file.id]);
      await creatorKnowledgeBaseModel.addFilesToKnowledgeBase(open.id, [file.id]);

      const creatorService = new TrashService(serverDB, userId, workspaceId);
      await creatorService.trashKnowledgeBases([restricted.id]);
      const [root] = await creatorService.trashFiles([file.id]);
      accessMocks.restrictedKnowledgeBaseIds = [restricted.id];
      accessMocks.liveRestrictedKnowledgeBaseIds = [];
      accessMocks.trashedRestrictedKnowledgeBaseIds = [restricted.id];

      const actorService = new TrashService(serverDB, otherUserId, workspaceId);
      expect((await actorService.list()).items.map((item) => item.resourceId)).toEqual([file.id]);
      expect(await actorService.countByType()).toEqual({ file: 1 });
      expect((await actorService.findByIds([root.id])).map((item) => item.resourceId)).toEqual([
        file.id,
      ]);
      expect(await actorService.restore([root.id])).toMatchObject({
        failed: [],
        restored: [{ resourceId: file.id }],
      });

      const [secondRoot] = await creatorService.trashFiles([file.id]);
      expect(await actorService.purge([secondRoot.id])).toEqual({
        failed: [],
        purged: 1,
        purgedIds: [secondRoot.id],
      });
      expect(await serverDB.select().from(files).where(eq(files.id, file.id))).toEqual([]);
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

    it('refuses to restore file mirrors beneath a parent trashed after the file closure', async () => {
      const firstFolder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'First folder',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const secondFolder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Second folder',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const file = await fileModel.create({
        fileType: 'text/plain',
        name: 'mirrored.txt',
        size: 1,
        url: 'files/mirrored.txt',
      });
      const firstMirror = await documentModel.create({
        fileId: file.id,
        fileType: 'text/plain',
        parentId: firstFolder.id,
        source: 'files/mirrored.txt',
        sourceType: 'file',
        title: 'First mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const secondMirror = await documentModel.create({
        fileId: file.id,
        fileType: 'text/plain',
        parentId: secondFolder.id,
        source: 'files/mirrored.txt',
        sourceType: 'file',
        title: 'Second mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });

      const [fileRoot] = await service.trashFiles([file.id]);
      await service.trashDocuments([secondFolder.id]);
      const outcome = await service.restore([fileRoot.id]);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: fileRoot.id }]);
      expect(await fileModel.findById(file.id)).toBeUndefined();
      expect(await documentModel.findById(firstMirror.id)).toBeUndefined();
      expect(await documentModel.findById(secondMirror.id)).toBeUndefined();
    });

    it('restores and purges the transitive document/file mirror closure', async () => {
      const { id: sourceFileId } = await fileModel.create({
        fileType: 'text/plain',
        name: 'source.txt',
        size: 10,
        url: 'files/source.txt',
      });
      const rootDocument = await documentModel.create({
        fileId: sourceFileId,
        fileType: 'text/plain',
        source: 'files/source.txt',
        sourceType: 'file',
        title: 'Source root',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const siblingMirror = await documentModel.create({
        fileId: sourceFileId,
        fileType: 'text/plain',
        source: 'files/source.txt',
        sourceType: 'file',
        title: 'Sibling mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const { id: anchoredFileId } = await fileModel.create({
        fileType: 'text/plain',
        name: 'anchored.txt',
        parentId: siblingMirror.id,
        size: 5,
        url: 'files/anchored.txt',
      });
      const anchoredMirror = await documentModel.create({
        fileId: anchoredFileId,
        fileType: 'text/plain',
        source: 'files/anchored.txt',
        sourceType: 'file',
        title: 'Anchored mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const nestedChild = await documentModel.create({
        fileType: 'custom/page',
        parentId: anchoredMirror.id,
        source: '',
        sourceType: 'api',
        title: 'Nested child',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const resourceIds = [
        rootDocument.id,
        sourceFileId,
        siblingMirror.id,
        anchoredFileId,
        anchoredMirror.id,
        nestedChild.id,
      ];

      const [root] = await service.trashDocuments([rootDocument.id]);

      expect(
        (await trashModel.findChildren(root.id)).map((item) => item.resourceId).sort(),
      ).toEqual(resourceIds.filter((id) => id !== rootDocument.id).sort());
      expect(await documentModel.findById(siblingMirror.id)).toBeUndefined();
      expect(await documentModel.findById(anchoredMirror.id)).toBeUndefined();
      expect(await documentModel.findById(nestedChild.id)).toBeUndefined();
      expect(await fileModel.findById(sourceFileId)).toBeUndefined();
      expect(await fileModel.findById(anchoredFileId)).toBeUndefined();

      await service.restore([root.id]);

      expect(await documentModel.findById(siblingMirror.id)).toMatchObject({
        fileId: sourceFileId,
      });
      expect(await documentModel.findById(anchoredMirror.id)).toMatchObject({
        fileId: anchoredFileId,
      });
      expect(await documentModel.findById(nestedChild.id)).toMatchObject({
        parentId: anchoredMirror.id,
      });
      expect(await fileModel.findById(anchoredFileId)).toMatchObject({
        parentId: siblingMirror.id,
      });

      const [purgeRoot] = await service.trashDocuments([rootDocument.id]);
      await service.purge([purgeRoot.id]);

      expect(
        await serverDB
          .select({ id: documents.id })
          .from(documents)
          .where(inArray(documents.id, resourceIds)),
      ).toEqual([]);
      expect(
        await serverDB
          .select({ id: files.id })
          .from(files)
          .where(inArray(files.id, [sourceFileId, anchoredFileId])),
      ).toEqual([]);
    });

    it('refuses to restore a document closure beneath a parent trashed afterward', async () => {
      const externalFolder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'External folder',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const sourceFile = await fileModel.create({
        fileType: 'text/plain',
        name: 'source.txt',
        size: 1,
        url: 'files/source-parent-check.txt',
      });
      const rootDocument = await documentModel.create({
        fileId: sourceFile.id,
        fileType: 'text/plain',
        source: 'files/source-parent-check.txt',
        sourceType: 'file',
        title: 'Root mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const siblingMirror = await documentModel.create({
        fileId: sourceFile.id,
        fileType: 'text/plain',
        parentId: externalFolder.id,
        source: 'files/source-parent-check.txt',
        sourceType: 'file',
        title: 'Nested mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });

      const [documentRoot] = await service.trashDocuments([rootDocument.id]);
      await service.trashDocuments([externalFolder.id]);
      const outcome = await service.restore([documentRoot.id]);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: documentRoot.id }]);
      expect(await documentModel.findById(rootDocument.id)).toBeUndefined();
      expect(await documentModel.findById(siblingMirror.id)).toBeUndefined();
      expect(await fileModel.findById(sourceFile.id)).toBeUndefined();
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

    it("restores another member's retained descendants without overwriting moves", async () => {
      const workspaceId = 'trash-private-descendant-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Private descendant',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const ownerModel = new DocumentModel(serverDB, userId, workspaceId);
      const memberModel = new DocumentModel(serverDB, otherUserId, workspaceId);
      const memberFileModel = new FileModel(serverDB, otherUserId, workspaceId);
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
      const movedPrivateFolder = await memberModel.create({
        fileType: 'custom/folder',
        parentId: publicFolder.id,
        source: '',
        sourceType: 'api',
        title: 'Private folder moved later',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const privateDestination = await memberModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Private destination',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const privateFile = await memberFileModel.create({
        fileType: 'text/plain',
        name: 'private child.txt',
        parentId: publicFolder.id,
        size: 1,
        url: 'files/private-child.txt',
        visibility: 'private',
      });
      const publicFile = await memberFileModel.create({
        fileType: 'text/plain',
        name: 'public child.txt',
        parentId: publicFolder.id,
        size: 1,
        url: 'files/public-child.txt',
        visibility: 'public',
      });

      const actorService = new TrashService(serverDB, userId, workspaceId);
      const [root] = await actorService.trashDocuments([publicFolder.id], {
        restrictToCreator: true,
      });

      expect(await ownerModel.findById(publicFolder.id)).toBeUndefined();
      expect(await memberModel.findById(privateFolder.id)).toMatchObject({ parentId: null });
      expect(await memberModel.findById(movedPrivateFolder.id)).toMatchObject({ parentId: null });
      expect(await memberFileModel.findById(privateFile.id)).toMatchObject({ parentId: null });
      expect(await memberFileModel.findById(publicFile.id)).toMatchObject({ parentId: null });
      expect(await new TrashModel(serverDB, userId, workspaceId).findChildren(root.id)).toEqual([]);

      const [internalRoot] = await serverDB
        .select()
        .from(trashItems)
        .where(eq(trashItems.id, root.id));
      expect(internalRoot.meta?.detachedEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ resourceId: privateFolder.id, resourceType: 'document' }),
          expect.objectContaining({ resourceId: movedPrivateFolder.id, resourceType: 'document' }),
          expect.objectContaining({ resourceId: privateFile.id, resourceType: 'file' }),
          expect.objectContaining({ resourceId: publicFile.id, resourceType: 'file' }),
        ]),
      );
      expect(JSON.stringify((await actorService.list()).items)).not.toContain(privateFolder.id);
      expect(JSON.stringify((await actorService.list()).items)).not.toContain(privateFile.id);
      expect(JSON.stringify((await actorService.list()).items)).not.toContain(publicFile.id);

      await memberModel.update(movedPrivateFolder.id, { parentId: privateDestination.id });
      await actorService.restore([root.id]);

      expect(await memberModel.findById(privateFolder.id)).toMatchObject({
        parentId: publicFolder.id,
      });
      expect(await memberModel.findById(movedPrivateFolder.id)).toMatchObject({
        parentId: privateDestination.id,
      });
      expect(await memberFileModel.findById(privateFile.id)).toMatchObject({
        parentId: publicFolder.id,
      });
      expect(await memberFileModel.findById(publicFile.id)).toMatchObject({
        parentId: publicFolder.id,
      });

      const [purgeRoot] = await actorService.trashDocuments([publicFolder.id], {
        restrictToCreator: true,
      });
      await actorService.purge([purgeRoot.id]);
      expect(await memberModel.findById(privateFolder.id)).toMatchObject({ parentId: null });
      expect(await memberFileModel.findById(privateFile.id)).toMatchObject({ parentId: null });
      expect(await memberFileModel.findById(publicFile.id)).toMatchObject({ parentId: null });
    });

    it('rolls back detached private edges when the trash transaction fails', async () => {
      const workspaceId = 'trash-private-edge-rollback-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Private edge rollback',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const actorModel = new DocumentModel(serverDB, userId, workspaceId);
      const memberModel = new DocumentModel(serverDB, otherUserId, workspaceId);
      const publicFolder = await actorModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Shared folder',
        totalCharCount: 0,
        totalLineCount: 0,
        visibility: 'public',
      });
      const privateChild = await memberModel.create({
        fileType: 'custom/page',
        parentId: publicFolder.id,
        source: '',
        sourceType: 'api',
        title: 'Private child',
        totalCharCount: 0,
        totalLineCount: 0,
      });

      await serverDB.execute(
        sql`ALTER TABLE workspace_audit_logs RENAME TO workspace_audit_logs_unavailable`,
      );
      try {
        await expect(
          new TrashService(serverDB, userId, workspaceId).trashDocuments([publicFolder.id]),
        ).rejects.toThrow();
      } finally {
        await serverDB.execute(
          sql`ALTER TABLE workspace_audit_logs_unavailable RENAME TO workspace_audit_logs`,
        );
      }

      expect(await actorModel.findById(publicFolder.id)).toMatchObject({ id: publicFolder.id });
      expect(await memberModel.findById(privateChild.id)).toMatchObject({
        parentId: publicFolder.id,
      });
      expect(
        await new TrashModel(serverDB, userId, workspaceId).findByResource(
          'document',
          publicFolder.id,
        ),
      ).toBeUndefined();
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

    it('serializes concurrent knowledge-base purges that share their last file', async () => {
      const firstKnowledgeBase = await knowledgeBaseModel.create({ name: 'First library' });
      const secondKnowledgeBase = await knowledgeBaseModel.create({ name: 'Second library' });
      await fileModel.createGlobalFile({
        creator: userId,
        fileType: 'text/plain',
        hashId: 'shared-kb-purge-hash',
        size: 9,
        url: 'files/shared-kb-purge.txt',
      });
      const { id: fileId } = await fileModel.create({
        fileHash: 'shared-kb-purge-hash',
        fileType: 'text/plain',
        knowledgeBaseId: firstKnowledgeBase.id,
        name: 'shared.txt',
        size: 9,
        url: 'files/shared-kb-purge.txt',
      });
      await serverDB.insert(knowledgeBaseFiles).values({
        fileId,
        knowledgeBaseId: secondKnowledgeBase.id,
        userId,
      });
      const [firstRoot] = await service.trashKnowledgeBases([firstKnowledgeBase.id]);
      const [secondRoot] = await service.trashKnowledgeBases([secondKnowledgeBase.id]);

      let fileLockReady!: () => void;
      const fileLock = new Promise<void>((resolve) => {
        fileLockReady = resolve;
      });
      let releaseFileLock!: () => void;
      const fileLockRelease = new Promise<void>((resolve) => {
        releaseFileLock = resolve;
      });
      const blockingTransaction = serverDB.transaction(async (tx) => {
        const model = new KnowledgeBaseModel(tx as unknown as LobeChatDatabase, userId);
        await model.lockLinkedFiles(firstKnowledgeBase.id);
        fileLockReady();
        await fileLockRelease;
      });
      await fileLock;

      const firstPurge = service.purge([firstRoot.id]);
      const secondPurge = service.purge([secondRoot.id]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseFileLock();
      await blockingTransaction;

      await expect(Promise.all([firstPurge, secondPurge])).resolves.toEqual([
        { failed: [], purged: 1, purgedIds: [firstRoot.id] },
        { failed: [], purged: 1, purgedIds: [secondRoot.id] },
      ]);
      expect(await serverDB.select().from(knowledgeBaseFiles)).toEqual([]);
      expect(await serverDB.select().from(knowledgeBases)).toEqual([]);
      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toEqual([]);
      expect(
        await serverDB
          .select()
          .from(globalFiles)
          .where(eq(globalFiles.hashId, 'shared-kb-purge-hash')),
      ).toEqual([]);
      expect(
        await serverDB
          .select()
          .from(trashItems)
          .where(inArray(trashItems.id, [firstRoot.id, secondRoot.id])),
      ).toEqual([]);
      expect(fileServiceMocks.deleteFiles).toHaveBeenCalledOnce();
      expect(fileServiceMocks.deleteFiles).toHaveBeenCalledWith(['files/shared-kb-purge.txt']);
    });

    it('retries knowledge-base storage cleanup after its database purge commits', async () => {
      const knowledgeBase = await knowledgeBaseModel.create({ name: 'Retry library' });
      await fileModel.createGlobalFile({
        creator: userId,
        fileType: 'text/plain',
        hashId: 'kb-retry-hash',
        size: 7,
        url: 'files/kb-retry.txt',
      });
      const { id: fileId } = await fileModel.create({
        fileHash: 'kb-retry-hash',
        fileType: 'text/plain',
        knowledgeBaseId: knowledgeBase.id,
        name: 'kb-retry.txt',
        size: 7,
        url: 'files/kb-retry.txt',
      });
      const [root] = await service.trashKnowledgeBases([knowledgeBase.id]);
      fileServiceMocks.deleteFiles.mockRejectedValueOnce(new Error('storage unavailable'));

      await expect(service.purge([root.id])).resolves.toEqual({
        failed: [{ code: 'purgeFailed', id: root.id }],
        purged: 0,
        purgedIds: [],
      });
      expect(
        await serverDB.select().from(knowledgeBases).where(eq(knowledgeBases.id, knowledgeBase.id)),
      ).toEqual([]);
      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toEqual([]);
      expect(await trashModel.findByIdIncludingQueued(root.id)).toMatchObject({
        meta: expect.objectContaining({
          storageCleanup: {
            files: [{ fileHash: 'kb-retry-hash', url: 'files/kb-retry.txt' }],
            pending: true,
          },
        }),
      });

      await expect(service.purge([root.id])).resolves.toEqual({
        failed: [],
        purged: 1,
        purgedIds: [root.id],
      });
      expect(fileServiceMocks.deleteFiles).toHaveBeenCalledTimes(2);
      expect(await trashModel.findByIdIncludingQueued(root.id)).toBeUndefined();
    });

    it('removes mirror-document ACL rows when purging a workspace knowledge base', async () => {
      const workspaceId = 'trash-kb-mirror-acl-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'KB mirror ACL',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const workspaceKnowledgeBaseModel = new KnowledgeBaseModel(serverDB, userId, workspaceId);
      const workspaceFileModel = new FileModel(serverDB, userId, workspaceId);
      const workspaceService = new TrashService(serverDB, userId, workspaceId);
      const knowledgeBase = await workspaceKnowledgeBaseModel.create({ name: 'Shared library' });
      const file = await workspaceFileModel.create({
        fileType: 'application/pdf',
        knowledgeBaseId: knowledgeBase.id,
        name: 'source.pdf',
        size: 9,
        url: 'files/source.pdf',
        visibility: 'public',
      });
      const [mirror] = await serverDB
        .insert(documents)
        .values({
          fileId: file.id,
          fileType: 'application/pdf',
          knowledgeBaseId: knowledgeBase.id,
          source: 'source.pdf',
          sourceType: 'file',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
          visibility: 'public',
          workspaceId,
        })
        .returning();
      await serverDB.insert(resourcePermissions).values({
        accessLevel: 'edit',
        createdBy: userId,
        resourceId: mirror.id,
        resourceType: 'document',
        workspaceId,
      });

      const [root] = await workspaceService.trashKnowledgeBases([knowledgeBase.id]);
      await workspaceService.purge([root.id]);

      expect(
        await serverDB
          .select()
          .from(resourcePermissions)
          .where(eq(resourcePermissions.resourceId, mirror.id)),
      ).toEqual([]);
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

    it('restores selected parent roots before independently trashed children', async () => {
      const folder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Selected parent',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const child = await documentModel.create({
        fileType: 'custom/page',
        parentId: folder.id,
        source: '',
        sourceType: 'api',
        title: 'Selected child',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const [childRoot] = await service.trashDocuments([child.id]);
      const [parentRoot] = await service.trashDocuments([folder.id]);

      const outcome = await service.restore([childRoot.id, parentRoot.id]);

      expect(outcome.failed).toEqual([]);
      expect(outcome.restored.map((item) => item.id)).toEqual([parentRoot.id, childRoot.id]);
      expect(await documentModel.findById(child.id)).toMatchObject({ parentId: folder.id });
    });

    it('orders a child after the selected closure that restores its parent', async () => {
      const grandparent = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Grandparent',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const parent = await documentModel.create({
        fileType: 'custom/folder',
        parentId: grandparent.id,
        source: '',
        sourceType: 'api',
        title: 'Closure-owned parent',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const child = await documentModel.create({
        fileType: 'custom/page',
        parentId: parent.id,
        source: '',
        sourceType: 'api',
        title: 'Independent child',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const [childRoot] = await service.trashDocuments([child.id]);
      const [grandparentRoot] = await service.trashDocuments([grandparent.id]);
      expect(
        (await trashModel.findChildren(grandparentRoot.id)).map((item) => item.resourceId),
      ).toContain(parent.id);

      const outcome = await service.restore([childRoot.id, grandparentRoot.id]);

      expect(outcome.failed).toEqual([]);
      expect(outcome.restored.map((item) => item.id)).toEqual([grandparentRoot.id, childRoot.id]);
      expect(await documentModel.findById(grandparent.id)).toBeDefined();
      expect(await documentModel.findById(parent.id)).toMatchObject({ parentId: grandparent.id });
      expect(await documentModel.findById(child.id)).toMatchObject({ parentId: parent.id });
    });

    it('orders a file root after the selected folder needed by its mirror child', async () => {
      const folder = await documentModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Mirror parent',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const file = await fileModel.create({
        fileType: 'text/plain',
        name: 'nested-mirror.txt',
        size: 1,
        url: 'files/nested-mirror.txt',
      });
      const mirror = await documentModel.create({
        fileId: file.id,
        fileType: 'custom/document',
        parentId: folder.id,
        source: 'files/nested-mirror.txt',
        sourceType: 'file',
        title: 'Nested mirror',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const [fileRoot] = await service.trashFiles([file.id]);
      const [folderRoot] = await service.trashDocuments([folder.id]);

      const outcome = await service.restore([fileRoot.id, folderRoot.id]);

      expect(outcome.failed).toEqual([]);
      expect(outcome.restored.map((item) => item.id)).toEqual([folderRoot.id, fileRoot.id]);
      expect(await documentModel.findById(folder.id)).toBeDefined();
      expect(await fileModel.findById(file.id)).toBeDefined();
      expect(await documentModel.findById(mirror.id)).toMatchObject({ parentId: folder.id });
    });

    it('orders a 200-root branching dependency graph without enumerating dependency paths', () => {
      const now = new Date();
      const row = (
        id: string,
        resourceType: 'document' | 'file',
        rootId: string | null,
        parentId?: string,
      ): TrashItemRow => ({
        createdAt: now,
        deletedAt: now,
        deletedByUserId: userId,
        expiresAt: now,
        id,
        meta: parentId ? { parentId } : null,
        resourceId: resourceType === 'document' ? id : `resource-${id}`,
        resourceType,
        rootId,
        title: null,
        userId,
        workspaceId: null,
      });
      const roots = Array.from({ length: 200 }, (_, index) => row(`root-${index}`, 'file', null));
      const children = roots.flatMap((root, index) => [
        row(`document-${index}`, 'document', root.id),
        ...(index + 1 < roots.length
          ? [row(`mirror-${index}-1`, 'document', root.id, `document-${index + 1}`)]
          : []),
        ...(index + 2 < roots.length
          ? [row(`mirror-${index}-2`, 'document', root.id, `document-${index + 2}`)]
          : []),
      ]);

      const ordered = orderTrashRestoreRoots(roots, children);

      expect(ordered.map((root) => root.id)).toEqual(roots.map((root) => root.id).reverse());
    });

    it("refuses to restore a public document beneath another creator's private trashed parent", async () => {
      const workspaceId = 'trash-private-parent-document-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Private parent document',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const actorModel = new DocumentModel(serverDB, userId, workspaceId);
      const parentOwnerModel = new DocumentModel(serverDB, otherUserId, workspaceId);
      const parent = await parentOwnerModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Private parent',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const child = await actorModel.create({
        fileType: 'custom/page',
        parentId: parent.id,
        source: '',
        sourceType: 'api',
        title: 'Public child',
        totalCharCount: 0,
        totalLineCount: 0,
        visibility: 'public',
      });
      const actorService = new TrashService(serverDB, userId, workspaceId);
      const [childRoot] = await actorService.trashDocuments([child.id]);
      await new TrashService(serverDB, otherUserId, workspaceId).trashDocuments([parent.id]);

      const outcome = await actorService.restore([childRoot.id]);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: childRoot.id }]);
      expect(await actorModel.findById(child.id)).toBeUndefined();
    });

    it("refuses to restore a public file beneath another creator's private trashed parent", async () => {
      const workspaceId = 'trash-private-parent-file-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Private parent file',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const parentOwnerModel = new DocumentModel(serverDB, otherUserId, workspaceId);
      const parent = await parentOwnerModel.create({
        fileType: 'custom/folder',
        source: '',
        sourceType: 'api',
        title: 'Private parent',
        totalCharCount: 0,
        totalLineCount: 0,
      });
      const actorFileModel = new FileModel(serverDB, userId, workspaceId);
      const file = await actorFileModel.create({
        fileType: 'text/plain',
        name: 'public.txt',
        parentId: parent.id,
        size: 4,
        url: 'files/public.txt',
        visibility: 'public',
      });
      const actorService = new TrashService(serverDB, userId, workspaceId);
      const [fileRoot] = await actorService.trashFiles([file.id]);
      await new TrashService(serverDB, otherUserId, workspaceId).trashDocuments([parent.id]);

      const outcome = await actorService.restore([fileRoot.id]);

      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: fileRoot.id }]);
      expect(await actorFileModel.findById(file.id)).toBeUndefined();
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

    it('removes attached document ACL rows when purging a workspace file', async () => {
      const workspaceId = 'trash-file-document-acl-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'File document ACL',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const workspaceFileModel = new FileModel(serverDB, userId, workspaceId);
      const workspaceDocumentModel = new DocumentModel(serverDB, userId, workspaceId);
      const workspaceService = new TrashService(serverDB, userId, workspaceId);
      const file = await workspaceFileModel.create({
        fileType: 'text/plain',
        name: 'attached-page-source.txt',
        size: 3,
        url: 'files/attached-page-source.txt',
        visibility: 'public',
      });
      const document = await workspaceDocumentModel.create({
        fileId: file.id,
        fileType: 'custom/page',
        source: '',
        sourceType: 'api',
        title: 'Attached public page',
        totalCharCount: 0,
        totalLineCount: 0,
        visibility: 'public',
      });
      await serverDB.insert(resourcePermissions).values({
        accessLevel: 'edit',
        createdBy: userId,
        resourceId: document.id,
        resourceType: 'document',
        workspaceId,
      });
      const [root] = await workspaceService.trashFiles([file.id]);

      await workspaceService.purge([root.id]);

      expect(
        await serverDB
          .select()
          .from(resourcePermissions)
          .where(eq(resourcePermissions.resourceId, document.id)),
      ).toEqual([]);
    });

    it('retries storage cleanup from the registry after the database purge commits', async () => {
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
      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toHaveLength(0);
      const [retryRoot] = await serverDB
        .select()
        .from(trashItems)
        .where(eq(trashItems.id, root.id));
      expect(retryRoot.meta?.storageCleanup).toEqual({
        files: [{ fileHash: 'trash-retryable-hash', url: 'files/retryable.txt' }],
        pending: true,
      });
      expect(await service.findByIds([root.id])).toEqual([]);
      expect(await TrashModel.pruneOrphans(serverDB)).toBe(0);

      // Simulate a concurrent invocation that entered with the stale root
      // object from before the first transaction wrote storageCleanup.
      fileServiceMocks.deleteFiles.mockRejectedValueOnce(new Error('storage still unavailable'));
      await expect(
        purgeFiles(
          {
            db: serverDB,
            fileService: { deleteFiles: fileServiceMocks.deleteFiles } as never,
            userId,
          },
          [fileId],
          { onlyTrashed: true, root },
        ),
      ).rejects.toThrow('storage still unavailable');
      expect(
        await serverDB.select().from(trashItems).where(eq(trashItems.id, root.id)),
      ).toHaveLength(1);

      expect(await service.purge([root.id])).toEqual({
        failed: [],
        purged: 1,
        purgedIds: [root.id],
      });
      expect(await serverDB.select().from(files).where(eq(files.id, fileId))).toHaveLength(0);
      expect(fileServiceMocks.deleteFiles).toHaveBeenCalledTimes(3);
    });

    it('batches initial and retried storage cleanup at the S3 request limit', async () => {
      const storageFiles = Array.from({ length: 1001 }, (_, index) => ({
        fileHash: `large-purge-hash-${index}`,
        url: `files/large-purge-${index}.txt`,
      }));
      const fileIds = storageFiles.map((_, index) => `large-purge-file-${index}`);
      const globalFileRows = storageFiles.map((file) => ({
        creator: userId,
        fileType: 'text/plain',
        hashId: file.fileHash,
        size: 1,
        url: file.url,
      }));
      const fileRows = storageFiles.map((file, index) => ({
        ...file,
        fileType: 'text/plain',
        id: fileIds[index],
        isDeleted: true,
        name: `large-purge-${index}.txt`,
        size: 1,
        userId,
      }));
      for (let index = 0; index < fileRows.length; index += 250) {
        await serverDB.insert(globalFiles).values(globalFileRows.slice(index, index + 250));
        await serverDB.insert(files).values(fileRows.slice(index, index + 250));
      }
      const root = await trashModel.register({
        deletedAt: new Date(),
        root: { resourceId: fileIds[0], resourceType: 'file' },
      });

      await purgeFiles(
        {
          db: serverDB,
          fileService: { deleteFiles: fileServiceMocks.deleteFiles } as never,
          userId,
        },
        fileIds,
        { onlyTrashed: true, root },
      );
      expect(fileServiceMocks.deleteFiles).toHaveBeenNthCalledWith(
        1,
        storageFiles.slice(0, 1000).map(({ url }) => url),
      );
      expect(fileServiceMocks.deleteFiles).toHaveBeenNthCalledWith(
        2,
        storageFiles.slice(1000).map(({ url }) => url),
      );

      fileServiceMocks.deleteFiles.mockClear();
      const [persistedRoot] = await serverDB
        .select()
        .from(trashItems)
        .where(eq(trashItems.id, root.id));
      await purgeFiles(
        {
          db: serverDB,
          fileService: { deleteFiles: fileServiceMocks.deleteFiles } as never,
          userId,
        },
        [],
        {
          onlyTrashed: true,
          root: persistedRoot,
        },
      );
      expect(fileServiceMocks.deleteFiles).toHaveBeenNthCalledWith(
        1,
        storageFiles.slice(0, 1000).map(({ url }) => url),
      );
      expect(fileServiceMocks.deleteFiles).toHaveBeenNthCalledWith(
        2,
        storageFiles.slice(1000).map(({ url }) => url),
      );
    });

    it('never exposes internal storage cleanup state in find or restore results', async () => {
      const file = await fileModel.create({
        fileType: 'text/plain',
        name: 'restore-private-meta.txt',
        size: 3,
        url: 'files/restore-private-meta.txt',
      });
      const [root] = await service.trashFiles([file.id]);
      await serverDB
        .update(trashItems)
        .set({
          meta: {
            detachedEdges: [
              {
                originalParentId: 'private-parent-id',
                resourceId: 'private-resource-id',
                resourceType: 'document',
              },
            ],
            storageCleanup: {
              files: [{ fileHash: 'private-hash', url: 'files/private-storage-key.txt' }],
              pending: true,
            },
          },
        })
        .where(eq(trashItems.id, root.id));

      const [found] = await service.findByIds([root.id]);
      expect(found.meta).toBeNull();

      const outcome = await service.restore([root.id]);
      expect(outcome.restored[0].meta).toBeNull();
      expect(JSON.stringify({ found, outcome })).not.toContain('private-hash');
      expect(JSON.stringify({ found, outcome })).not.toContain('private-storage-key');
      expect(JSON.stringify({ found, outcome })).not.toContain('private-parent-id');
      expect(JSON.stringify({ found, outcome })).not.toContain('private-resource-id');
    });

    it('does not start storage cleanup when the database purge rejects', async () => {
      await fileModel.createGlobalFile({
        creator: userId,
        fileType: 'text/plain',
        hashId: 'db-failure-hash',
        size: 3,
        url: 'files/db-failure.txt',
      });
      const file = await fileModel.create({
        fileHash: 'db-failure-hash',
        fileType: 'text/plain',
        name: 'db-failure.txt',
        size: 3,
        url: 'files/db-failure.txt',
      });
      const [root] = await service.trashFiles([file.id]);
      vi.spyOn(TrashModel, 'markStorageCleanupPending').mockRejectedValueOnce(
        new Error('transaction commit failed'),
      );

      expect(await service.purge([root.id])).toEqual({
        failed: [{ code: 'purgeFailed', id: root.id }],
        purged: 0,
        purgedIds: [],
      });
      expect(fileServiceMocks.deleteFiles).not.toHaveBeenCalled();
      expect(await serverDB.select().from(files).where(eq(files.id, file.id))).toHaveLength(1);
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
      expect(outcome).toEqual({
        failed: 0,
        nextCursor: expect.objectContaining({ id: expect.any(String) }),
        pruned: 1,
        purged: 2,
        scanned: 2,
      });
      expect(await serverDB.select().from(files).where(eq(files.id, mine.id))).toHaveLength(0);
      expect(await serverDB.select().from(files).where(eq(files.id, theirs.id))).toHaveLength(0);
      expect(await serverDB.select().from(files).where(eq(files.id, fresh.id))).toHaveLength(1);
      expect((await service.list()).items.map((i) => i.resourceId)).toEqual([fresh.id]);
    });

    it('advances beyond a fully failing batch so later expired roots are still purged', async () => {
      const roots: { id: string }[] = [];
      for (const index of [0, 1]) {
        const hash = `failing-hash-${index}`;
        await fileModel.createGlobalFile({
          creator: userId,
          fileType: 'text/plain',
          hashId: hash,
          size: 1,
          url: `files/failing-${index}.txt`,
        });
        const file = await fileModel.create({
          fileHash: hash,
          fileType: 'text/plain',
          name: `failing-${index}.txt`,
          size: 1,
          url: `files/failing-${index}.txt`,
        });
        roots.push((await service.trashFiles([file.id]))[0]);
      }
      const laterFile = await fileModel.create({
        fileType: 'text/plain',
        name: 'later.txt',
        size: 1,
        url: 'files/later.txt',
      });
      const [laterRoot] = await service.trashFiles([laterFile.id]);
      const now = new Date();
      for (const [index, root] of [...roots, laterRoot].entries()) {
        await serverDB
          .update(trashItems)
          .set({ expiresAt: new Date(now.getTime() - (3 - index) * 1000) })
          .where(eq(trashItems.id, root.id));
      }
      fileServiceMocks.deleteFiles.mockRejectedValue(new Error('storage unavailable'));

      const first = await TrashService.sweepExpired(serverDB, { limit: 2, now });
      expect(first).toMatchObject({ failed: 2, purged: 0, scanned: 2 });
      expect(first.nextCursor).not.toBeNull();

      const second = await TrashService.sweepExpired(serverDB, {
        cursor: first.nextCursor!,
        limit: 2,
        now,
      });
      expect(second).toMatchObject({ failed: 0, purged: 1, scanned: 1 });
      expect(await serverDB.select().from(files).where(eq(files.id, laterFile.id))).toEqual([]);
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
        nextCursor: expect.objectContaining({ id: expect.any(String) }),
        pruned: 0,
        purged: 2,
        scanned: 2,
      });
      expect(await serverDB.select().from(files)).toHaveLength(0);
    });

    it('keeps roots visible when the purge queue is unavailable', async () => {
      const file = await fileModel.create({
        fileType: 'text/plain',
        name: 'queue-unavailable.txt',
        size: 1,
        url: 'files/queue-unavailable.txt',
      });
      await service.trashFiles([file.id]);
      workflowMocks.triggerTrashPurge.mockResolvedValue(false);

      await expect(service.emptyTrash()).rejects.toThrow('Trash purge queue is not configured');

      expect((await service.list()).items.map((item) => item.resourceId)).toEqual([file.id]);
      expect(await serverDB.select().from(files).where(eq(files.id, file.id))).toHaveLength(1);
    });

    it('keeps roots visible when publishing purge work fails', async () => {
      const file = await fileModel.create({
        fileType: 'text/plain',
        name: 'queue-rejected.txt',
        size: 1,
        url: 'files/queue-rejected.txt',
      });
      await service.trashFiles([file.id]);
      workflowMocks.triggerTrashPurge.mockRejectedValue(new Error('publish rejected'));

      await expect(service.emptyTrash()).rejects.toThrow('publish rejected');

      expect((await service.list()).items.map((item) => item.resourceId)).toEqual([file.id]);
      expect(await serverDB.select().from(files).where(eq(files.id, file.id))).toHaveLength(1);
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
