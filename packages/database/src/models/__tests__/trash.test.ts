import { TRASH_RETENTION_MS } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  trashItems,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TrashModel } from '../trash';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'trash-model-user';
const otherUserId = 'trash-model-other';
const workspaceId = 'trash-model-ws';

const model = new TrashModel(serverDB, userId);
const otherModel = new TrashModel(serverDB, otherUserId);

const at = (iso: string) => new Date(iso);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TrashModel', () => {
  describe('register', () => {
    it('registers a root with children and stamps expiry from the retention window', async () => {
      const deletedAt = at('2026-08-01T00:00:00Z');
      const root = await model.register({
        children: [
          { resourceId: 'doc_1', resourceType: 'document', title: 'first' },
          { resourceId: 'doc_2', resourceType: 'document', title: 'second' },
        ],
        deletedAt,
        root: { resourceId: 'folder_1', resourceType: 'document', title: 'Folder' },
      });

      expect(root.rootId).toBeNull();
      expect(root.deletedByUserId).toBe(userId);
      expect(root.expiresAt.getTime()).toBe(deletedAt.getTime() + TRASH_RETENTION_MS);

      const children = await model.findChildren(root.id);
      expect(children.map((c) => c.resourceId).sort()).toEqual(['doc_1', 'doc_2']);
      expect(children.every((c) => c.rootId === root.id)).toBe(true);
    });

    it('is idempotent on the root resource and keeps a child that was trashed earlier on its own', async () => {
      // A file trashed last week keeps its own root row when its folder is
      // trashed today: it was in the bin before the folder and must stay there
      // after the folder is restored.
      const fileRoot = await model.register({
        deletedAt: at('2026-08-01T00:00:00Z'),
        root: { resourceId: 'file_old', resourceType: 'file', title: 'old.txt' },
      });
      const folderRoot = await model.register({
        children: [
          { resourceId: 'file_old', resourceType: 'file', title: 'old.txt' },
          { resourceId: 'file_new', resourceType: 'file', title: 'new.txt' },
        ],
        deletedAt: at('2026-08-08T00:00:00Z'),
        root: { resourceId: 'folder_1', resourceType: 'document', title: 'Folder' },
      });
      const again = await model.register({
        deletedAt: at('2026-08-09T00:00:00Z'),
        root: { resourceId: 'folder_1', resourceType: 'document', title: 'Folder renamed' },
      });

      expect(again.id).toBe(folderRoot.id);
      expect(again.title).toBe('Folder renamed');

      const oldFile = await model.findByResource('file', 'file_old');
      expect(oldFile?.id).toBe(fileRoot.id);
      expect(oldFile?.rootId).toBeNull();

      const children = await model.findChildren(folderRoot.id);
      expect(children.map((c) => c.resourceId)).toEqual(['file_new']);
    });
  });

  describe('list / countByType', () => {
    it('lists roots only, newest first, scoped to the caller, with type filter and keyset paging', async () => {
      for (let i = 0; i < 5; i++) {
        await model.register({
          children: [{ resourceId: `child_${i}`, resourceType: 'document' }],
          deletedAt: at(`2026-08-0${i + 1}T00:00:00Z`),
          root: { resourceId: `file_${i}`, resourceType: 'file', title: `file ${i}` },
        });
      }
      await model.register({
        deletedAt: at('2026-08-09T00:00:00Z'),
        root: { resourceId: 'doc_1', resourceType: 'document', title: 'a document' },
      });
      await otherModel.register({
        deletedAt: at('2026-08-10T00:00:00Z'),
        root: { resourceId: 'file_other', resourceType: 'file', title: 'not mine' },
      });

      const first = await model.list({ limit: 3 });
      expect(first.items.map((i) => i.resourceId)).toEqual(['doc_1', 'file_4', 'file_3']);
      expect(first.nextCursor).toBeTruthy();

      const second = await model.list({ cursor: first.nextCursor, limit: 3 });
      expect(second.items.map((i) => i.resourceId)).toEqual(['file_2', 'file_1', 'file_0']);
      expect(second.nextCursor).toBeNull();

      const filesOnly = await model.list({ resourceType: 'file' });
      expect(filesOnly.items).toHaveLength(5);
      expect(filesOnly.items.every((i) => i.rootId === null)).toBe(true);

      expect(await model.countByType()).toEqual({ document: 1, file: 5 });
      expect(await otherModel.countByType()).toEqual({ file: 1 });
    });

    it('scopes workspace listings to the workspace, not the caller', async () => {
      const wsModel = new TrashModel(serverDB, userId, workspaceId);
      const wsOther = new TrashModel(serverDB, otherUserId, workspaceId);
      await wsModel.register({
        deletedAt: at('2026-08-01T00:00:00Z'),
        root: { resourceId: 'file_ws', resourceType: 'file', title: 'spec.txt' },
      });
      await model.register({
        deletedAt: at('2026-08-02T00:00:00Z'),
        root: { resourceId: 'file_personal', resourceType: 'file', title: 'mine.txt' },
      });

      const seenByTeammate = await wsOther.list();
      expect(seenByTeammate.items.map((i) => i.resourceId)).toEqual(['file_ws']);
      expect((await model.list()).items.map((i) => i.resourceId)).toEqual(['file_personal']);
    });

    it('shows a private resource only to its original creator, not the delete actor', async () => {
      const deleteActor = new TrashModel(serverDB, userId, workspaceId);
      const creator = new TrashModel(serverDB, otherUserId, workspaceId);
      const root = await deleteActor.register({
        deletedAt: at('2026-08-03T00:00:00Z'),
        root: {
          meta: { creatorUserId: otherUserId, visibility: 'private' },
          resourceId: 'file_private',
          resourceType: 'file',
          title: 'private.txt',
        },
      });

      expect(root.userId).toBe(otherUserId);
      expect(root.deletedByUserId).toBe(userId);
      expect((await deleteActor.list()).items).toHaveLength(0);
      expect(await deleteActor.countByType()).toEqual({});
      expect((await creator.list()).items.map((item) => item.resourceId)).toEqual(['file_private']);
      expect(await creator.countByType()).toEqual({ file: 1 });
    });

    it('excludes every root backed by a restricted knowledge base', async () => {
      const wsModel = new TrashModel(serverDB, userId, workspaceId);
      await serverDB.insert(knowledgeBases).values([
        {
          id: 'trash-restricted-kb',
          name: 'Restricted',
          userId,
          workspaceId,
        },
        { id: 'trash-open-kb', name: 'Open', userId, workspaceId },
      ]);
      await serverDB.insert(files).values([
        {
          fileType: 'text/plain',
          id: 'trash-restricted-file',
          name: 'restricted.txt',
          size: 1,
          url: 'files/restricted.txt',
          userId,
          workspaceId,
        },
        {
          fileType: 'text/plain',
          id: 'trash-open-file',
          name: 'open.txt',
          size: 1,
          url: 'files/open.txt',
          userId,
          workspaceId,
        },
      ]);
      await serverDB.insert(knowledgeBaseFiles).values({
        fileId: 'trash-restricted-file',
        knowledgeBaseId: 'trash-restricted-kb',
        userId,
        workspaceId,
      });
      await serverDB.insert(documents).values([
        {
          fileType: 'custom/page',
          id: 'trash-direct-kb-document',
          knowledgeBaseId: 'trash-restricted-kb',
          source: '',
          sourceType: 'api',
          title: 'Direct restricted page',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
          workspaceId,
        },
        {
          fileId: 'trash-restricted-file',
          fileType: 'text/plain',
          id: 'trash-file-backed-document',
          source: 'files/restricted.txt',
          sourceType: 'file',
          title: 'File-backed restricted page',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
          workspaceId,
        },
        {
          fileId: 'trash-open-file',
          fileType: 'text/plain',
          id: 'trash-open-document',
          source: 'files/open.txt',
          sourceType: 'file',
          title: 'Open page',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
          workspaceId,
        },
      ]);

      const entries = await Promise.all(
        [
          ['trash-restricted-kb', 'knowledgeBase'],
          ['trash-restricted-file', 'file'],
          ['trash-direct-kb-document', 'document'],
          ['trash-file-backed-document', 'document'],
          ['trash-open-document', 'document'],
        ].map(async ([resourceId, resourceType], index) =>
          wsModel.register({
            deletedAt: at(`2026-08-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
            root: {
              resourceId,
              resourceType: resourceType as 'document' | 'file' | 'knowledgeBase',
            },
          }),
        ),
      );

      const restrictedResources = {
        knowledgeBaseIds: ['trash-restricted-kb'],
        membershipKnowledgeBaseIds: ['trash-restricted-kb'],
      };
      expect(await wsModel.countByType(restrictedResources)).toEqual({ document: 1 });
      const hidden = await wsModel.findRestrictedResourceRootIds(entries, restrictedResources);
      expect(hidden).toEqual(new Set(entries.slice(0, 4).map((entry) => entry.id)));
      expect(hidden.has(entries[4].id)).toBe(false);
    });
  });

  describe('removeByIds', () => {
    it('drops the root and cascades its children', async () => {
      const root = await model.register({
        children: [{ resourceId: 'file_1', resourceType: 'file' }],
        deletedAt: at('2026-08-01T00:00:00Z'),
        root: { resourceId: 'folder_1', resourceType: 'document' },
      });
      await model.removeByIds([root.id]);
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });
  });

  describe('expireAllRoots', () => {
    it('hides the selected active roots and makes them immediately sweepable', async () => {
      const deletedAt = at('2026-08-01T00:00:00Z');
      await model.register({
        deletedAt,
        root: { resourceId: 'file_queued', resourceType: 'file' },
      });
      await model.register({
        deletedAt,
        root: { resourceId: 'doc_active', resourceType: 'document' },
      });
      await otherModel.register({
        deletedAt,
        root: { resourceId: 'file_other', resourceType: 'file' },
      });

      const queuedIds = await model.expireAllRoots({ resourceType: 'file' });
      expect(queuedIds).toHaveLength(1);
      expect((await model.list()).items.map((item) => item.resourceId)).toEqual(['doc_active']);
      expect(await model.countByType()).toEqual({ document: 1 });
      expect(await model.findByResource('file', 'file_queued')).toBeUndefined();

      const due = await TrashModel.listExpiredRoots(serverDB, {
        limit: 10,
        now: at('2026-08-02T00:00:00Z'),
      });
      expect(due.map((item) => item.resourceId)).toEqual(['file_queued']);

      await model.restoreQueuedRoots(queuedIds);
      expect((await model.list()).items.map((item) => item.resourceId).sort()).toEqual([
        'doc_active',
        'file_queued',
      ]);
      expect(await TrashModel.listExpiredRoots(serverDB, { limit: 10, now: deletedAt })).toEqual(
        [],
      );
    });
  });

  describe('purge arbitration', () => {
    it('allows one purge claimant and keeps restore blocked across retry hand-off', async () => {
      const root = await model.register({
        deletedAt: at('2026-08-01T00:00:00Z'),
        root: { resourceId: 'file_claimed', resourceType: 'file' },
      });
      const claimedAt = at('2026-09-01T00:00:00Z');
      const claimed = await model.claimRootForPurge(root.id, {
        claimedAt,
        id: 'claim-1',
        staleBefore: at('2026-08-31T23:00:00Z'),
      });
      expect(claimed?.meta?.purgeClaim).toEqual({
        claimedAt: claimedAt.toISOString(),
        id: 'claim-1',
      });
      await expect(
        model.claimRootForPurge(root.id, {
          claimedAt: at('2026-09-01T00:01:00Z'),
          id: 'claim-2',
          staleBefore: at('2026-08-31T23:01:00Z'),
        }),
      ).resolves.toBeUndefined();
      await expect(
        serverDB.transaction((trx) => model.findActiveRootForUpdate(root.id, trx)),
      ).resolves.toBeUndefined();
      expect((await model.list()).items[0].meta).toBeNull();

      const stolen = await model.claimRootForPurge(root.id, {
        claimedAt: at('2026-09-01T02:00:00Z'),
        id: 'claim-stale-retry',
        staleBefore: at('2026-09-01T01:00:00Z'),
      });
      expect(stolen?.meta?.purgeClaim?.id).toBe('claim-stale-retry');
      await model.releasePurgeClaim(root.id, 'claim-stale-retry');
      const released = await model.findByIdIncludingQueued(root.id);
      expect(released?.meta).toMatchObject({ purgeBlocked: true });
      await expect(
        serverDB.transaction((trx) => model.findActiveRootForUpdate(root.id, trx)),
      ).resolves.toBeUndefined();

      const retry = await model.claimRootForPurge(root.id, {
        claimedAt: at('2026-09-01T01:00:00Z'),
        id: 'claim-retry',
        staleBefore: at('2026-09-01T00:00:00Z'),
      });
      expect(retry?.meta?.purgeClaim?.id).toBe('claim-retry');
      await expect(model.removeClaimedRoot(root.id, 'wrong-claim')).resolves.toBe(false);
      await expect(model.removeClaimedRoot(root.id, 'claim-retry')).resolves.toBe(true);
    });

    it('locks an unclaimed active root for restore and removes only active stale rows', async () => {
      const restorable = await model.register({
        deletedAt: at('2026-08-01T00:00:00Z'),
        root: { resourceId: 'file_restorable', resourceType: 'file' },
      });

      await expect(
        serverDB.transaction((trx) => model.findActiveRootForUpdate(restorable.id, trx)),
      ).resolves.toMatchObject({ id: restorable.id });
      await model.removeActiveByIds([restorable.id]);
      await expect(model.findById(restorable.id)).resolves.toBeUndefined();
    });
  });

  describe('sweep helpers', () => {
    it('listExpiredRoots returns roots past their expiry across users, oldest first', async () => {
      const now = at('2026-09-15T00:00:00Z');
      await model.register({
        deletedAt: at('2026-08-01T00:00:00Z'), // expires 08-31
        root: { resourceId: 'file_expired', resourceType: 'file' },
      });
      await otherModel.register({
        deletedAt: at('2026-07-01T00:00:00Z'), // expires 07-31
        root: { resourceId: 'file_older', resourceType: 'file' },
      });
      await model.register({
        deletedAt: at('2026-09-10T00:00:00Z'), // not yet
        root: { resourceId: 'file_fresh', resourceType: 'file' },
      });

      const due = await TrashModel.listExpiredRoots(serverDB, { limit: 10, now });
      expect(due.map((r) => r.resourceId)).toEqual(['file_older', 'file_expired']);
    });

    it('listExpiredRoots advances by expiresAt and id when timestamps are equal', async () => {
      const deletedAt = at('2026-07-01T00:00:00Z');
      const now = at('2026-09-15T00:00:00Z');
      await Promise.all(
        ['file_equal_a', 'file_equal_b', 'file_equal_c'].map((resourceId) =>
          model.register({
            deletedAt,
            root: { resourceId, resourceType: 'file' },
          }),
        ),
      );

      const all = await TrashModel.listExpiredRoots(serverDB, { limit: 10, now });
      const first = all[0];
      const rest = await TrashModel.listExpiredRoots(serverDB, {
        cursor: { expiresAt: first.expiresAt, id: first.id },
        limit: 10,
        now,
      });

      expect(rest.map(({ id }) => id)).toEqual(all.slice(1).map(({ id }) => id));
    });

    it('pruneOrphans drops registry rows whose resource is gone or no longer stamped', async () => {
      const deletedAt = at('2026-08-01T00:00:00Z');
      await serverDB.insert(files).values([
        {
          deletedAt,
          fileType: 'text/plain',
          id: 'file_stamped',
          isDeleted: true,
          name: 'still-trashed.txt',
          size: 1,
          url: 'files/still-trashed.txt',
          userId,
        },
        {
          fileType: 'text/plain',
          id: 'file_live',
          name: 'restored-elsewhere.txt',
          size: 1,
          url: 'files/restored-elsewhere.txt',
          userId,
        },
      ]);
      await model.register({
        deletedAt,
        root: { resourceId: 'file_stamped', resourceType: 'file' },
      });
      await model.register({
        deletedAt,
        root: { resourceId: 'file_live', resourceType: 'file' },
      });
      await model.register({
        deletedAt,
        root: { resourceId: 'file_gone', resourceType: 'file' },
      });
      const pendingRoot = await model.register({
        deletedAt,
        root: { resourceId: 'file_pending_cleanup', resourceType: 'file' },
      });
      await serverDB
        .update(trashItems)
        .set({
          meta: {
            storageCleanup: {
              files: [{ fileHash: 'pending-hash', url: 'files/pending.txt' }],
              pending: true,
            },
          },
        })
        .where(eq(trashItems.id, pendingRoot.id));

      const publicPendingItem = (await model.list()).items.find(({ id }) => id === pendingRoot.id);
      expect(publicPendingItem?.meta).toBeNull();
      expect(JSON.stringify(publicPendingItem)).not.toContain('pending-hash');
      expect(JSON.stringify(publicPendingItem)).not.toContain('files/pending.txt');

      const pruned = await TrashModel.pruneOrphans(serverDB);
      expect(pruned).toBe(2);
      const left = await serverDB.select().from(trashItems).where(eq(trashItems.userId, userId));
      expect(left.map((r) => r.resourceId).sort()).toEqual([
        'file_pending_cleanup',
        'file_stamped',
      ]);
    });
  });
});
