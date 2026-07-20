// @vitest-environment node
import { WORKSPACE_SYSTEM_ROLES } from '@lobechat/const/rbac';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, documentShares, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { seedWorkspaceRoles } from '../../utils/seedWorkspaceRoles';
import { DocumentShareModel } from '../documentShare';
import { RbacModel } from '../rbac';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'doc-share-test-user-id';
const userId2 = 'doc-share-test-user-id-2';
const docId = 'doc-share-test-doc';
const docId2User2 = 'doc-share-test-doc-user2';

const shareModel = new DocumentShareModel(serverDB, userId);
const shareModelOther = new DocumentShareModel(serverDB, userId2);

const baseDocFields = {
  fileType: 'text/markdown',
  source: 'editor',
  sourceType: 'agent' as const,
  totalCharCount: 0,
  totalLineCount: 0,
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.transaction(async (tx) => {
    await tx.insert(users).values([
      { id: userId, fullName: 'Alice', avatar: 'alice.png' },
      { id: userId2, fullName: 'Bob', avatar: 'bob.png' },
    ]);
    await tx.insert(documents).values([
      { id: docId, userId, title: 'Doc 1', ...baseDocFields },
      { id: docId2User2, userId: userId2, title: 'Doc 2', ...baseDocFields },
    ]);
  });
});

afterEach(async () => {
  await serverDB.delete(documentShares);
  await serverDB.delete(documents);
  await serverDB.delete(users);
});

describe('DocumentShareModel', () => {
  describe('create', () => {
    it('creates a share with default private visibility and read permission', async () => {
      const result = await shareModel.create(docId);
      expect(result).toBeDefined();
      expect(result!.documentId).toBe(docId);
      expect(result!.userId).toBe(userId);
      expect(result!.visibility).toBe('private');
      expect(result!.permission).toBe('read');
    });

    it('creates a share with link visibility', async () => {
      const result = await shareModel.create(docId, { visibility: 'link' });
      expect(result!.visibility).toBe('link');
      expect(result!.permission).toBe('read');
    });

    it('throws when document does not exist', async () => {
      await expect(shareModel.create('missing')).rejects.toThrow(
        'Document not found or not owned by user',
      );
    });

    it('throws when document belongs to another user', async () => {
      await expect(shareModel.create(docId2User2)).rejects.toThrow(
        'Document not found or not owned by user',
      );
    });

    it('returns the existing share on duplicate create', async () => {
      const first = await shareModel.create(docId, { visibility: 'link' });
      const second = await shareModel.create(docId);
      expect(second!.id).toBe(first!.id);
      expect(second!.visibility).toBe('link');
    });
  });

  describe('updateVisibility', () => {
    it('updates the visibility on an existing share', async () => {
      await shareModel.create(docId, { visibility: 'private' });
      const result = await shareModel.updateVisibility(docId, 'link');
      expect(result!.visibility).toBe('link');
    });

    it('returns null when no share exists', async () => {
      const result = await shareModel.updateVisibility(docId, 'link');
      expect(result).toBeNull();
    });

    it('does not affect another users share', async () => {
      await shareModelOther.create(docId2User2, { visibility: 'private' });
      const result = await shareModel.updateVisibility(docId2User2, 'link');
      expect(result).toBeNull();

      const owned = await shareModelOther.getByDocumentId(docId2User2);
      expect(owned!.visibility).toBe('private');
    });
  });

  describe('updatePermission', () => {
    it('updates the permission on an existing share', async () => {
      await shareModel.create(docId, { visibility: 'link' });
      const result = await shareModel.updatePermission(docId, 'comment');
      expect(result!.permission).toBe('comment');
    });

    it('returns null when no share exists', async () => {
      const result = await shareModel.updatePermission(docId, 'comment');
      expect(result).toBeNull();
    });
  });

  describe('deleteByDocumentId', () => {
    it('deletes the share row', async () => {
      await shareModel.create(docId);
      await shareModel.deleteByDocumentId(docId);
      const result = await shareModel.getByDocumentId(docId);
      expect(result).toBeNull();
    });

    it('does not delete another users share', async () => {
      await shareModelOther.create(docId2User2);
      await shareModel.deleteByDocumentId(docId2User2);
      const result = await shareModelOther.getByDocumentId(docId2User2);
      expect(result).not.toBeNull();
    });
  });

  describe('getByDocumentId', () => {
    it('returns null when no share', async () => {
      const result = await shareModel.getByDocumentId(docId);
      expect(result).toBeNull();
    });

    it('returns the share when owner queries', async () => {
      const created = await shareModel.create(docId, { visibility: 'link' });
      const result = await shareModel.getByDocumentId(docId);
      expect(result!.id).toBe(created!.id);
      expect(result!.visibility).toBe('link');
    });

    it('does not leak another users share', async () => {
      await shareModelOther.create(docId2User2);
      const result = await shareModel.getByDocumentId(docId2User2);
      expect(result).toBeNull();
    });
  });

  describe('findByDocumentIdWithAccessCheck (static)', () => {
    it('returns isOwner=true for the owner regardless of visibility', async () => {
      await shareModel.create(docId, { visibility: 'private' });
      const result = await DocumentShareModel.findByDocumentIdWithAccessCheck(
        serverDB,
        docId,
        userId,
      );
      expect(result.isOwner).toBe(true);
      expect(result.visibility).toBe('private');
    });

    it('returns isOwner=true for the owner even when no share row exists', async () => {
      const result = await DocumentShareModel.findByDocumentIdWithAccessCheck(
        serverDB,
        docId,
        userId,
      );
      expect(result.isOwner).toBe(true);
      expect(result.visibility).toBe('private');
    });

    it('returns isOwner=false for anonymous when visibility is link', async () => {
      await shareModel.create(docId, { visibility: 'link' });
      const result = await DocumentShareModel.findByDocumentIdWithAccessCheck(
        serverDB,
        docId,
        undefined,
      );
      expect(result.isOwner).toBe(false);
      expect(result.visibility).toBe('link');
      expect(result.ownerDisplayName).toBe('Alice');
    });

    it('throws NOT_FOUND when document does not exist', async () => {
      await expect(
        DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, 'missing', userId),
      ).rejects.toThrow(TRPCError);

      try {
        await DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, 'missing', userId);
      } catch (error) {
        expect((error as TRPCError).code).toBe('NOT_FOUND');
      }
    });

    it('throws FORBIDDEN when visibility is private and user is not owner', async () => {
      await shareModel.create(docId, { visibility: 'private' });
      await expect(
        DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, docId, userId2),
      ).rejects.toThrow(TRPCError);

      try {
        await DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, docId, userId2);
      } catch (error) {
        expect((error as TRPCError).code).toBe('FORBIDDEN');
      }
    });

    it('throws FORBIDDEN when no share row exists and user is not owner', async () => {
      try {
        await DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, docId, userId2);
        throw new Error('should not reach');
      } catch (error) {
        expect((error as TRPCError).code).toBe('FORBIDDEN');
      }
    });
  });

  describe('incrementPageViewCount (static)', () => {
    it('increments the count for an existing share', async () => {
      await shareModel.create(docId, { visibility: 'link' });

      const initial = await shareModel.getByDocumentId(docId);
      expect(initial!.pageViewCount).toBe(0);

      await DocumentShareModel.incrementPageViewCount(serverDB, docId);
      await DocumentShareModel.incrementPageViewCount(serverDB, docId);

      const after = await shareModel.getByDocumentId(docId);
      expect(after!.pageViewCount).toBe(2);
    });
  });

  describe('workspace mode ownership', () => {
    const workspaceId = 'doc-share-ws-ownership';
    const wsDocId = 'doc-share-ws-ownership-doc';
    let wsShareModel: DocumentShareModel;

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Ownership WS',
        primaryOwnerId: userId,
        slug: 'doc-share-ws-ownership',
      });
      await serverDB
        .insert(documents)
        .values({ id: wsDocId, title: 'WS Doc', userId, workspaceId, ...baseDocFields });
      wsShareModel = new DocumentShareModel(serverDB, userId, workspaceId);
    });

    it('getByDocumentId should still find the share after switching visibility to link', async () => {
      await wsShareModel.create(wsDocId, { visibility: 'private' });

      const updated = await wsShareModel.updateVisibility(wsDocId, 'link');
      expect(updated).not.toBeNull();

      // Regression: document_shares.visibility is 'private' | 'link' (share
      // semantics) and must not be fed into the workspace row-visibility filter.
      const info = await wsShareModel.getByDocumentId(wsDocId);
      expect(info).not.toBeNull();
      expect(info!.visibility).toBe('link');
    });

    it('updatePermission works on a link share in workspace mode', async () => {
      await wsShareModel.create(wsDocId, { visibility: 'link' });

      const updated = await wsShareModel.updatePermission(wsDocId, 'edit');
      expect(updated).not.toBeNull();
      expect(updated!.permission).toBe('edit');
    });

    it('deleteByDocumentId removes a link share in workspace mode', async () => {
      await wsShareModel.create(wsDocId, { visibility: 'link' });

      await wsShareModel.deleteByDocumentId(wsDocId);

      const info = await wsShareModel.getByDocumentId(wsDocId);
      expect(info).toBeNull();
    });

    describe('findByDocumentIdWithAccessCheck — private is creator-only, even in a workspace', () => {
      beforeEach(async () => {
        await seedWorkspaceRoles(serverDB, workspaceId);
        await new RbacModel(serverDB, userId2).assignWorkspaceRole({
          roleName: WORKSPACE_SYSTEM_ROLES.VIEWER,
          userId: userId2,
          workspaceId,
        });
      });

      it('rejects a workspace member (viewer role) for a private share', async () => {
        await wsShareModel.create(wsDocId, { visibility: 'private' });

        try {
          await DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, wsDocId, userId2);
          throw new Error('should not reach');
        } catch (error) {
          expect((error as TRPCError).code).toBe('FORBIDDEN');
        }
      });

      it('rejects a workspace member for a doc with NO share record', async () => {
        try {
          await DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, wsDocId, userId2);
          throw new Error('should not reach');
        } catch (error) {
          expect((error as TRPCError).code).toBe('FORBIDDEN');
        }
      });

      it('allows the creator to view their own private share', async () => {
        await wsShareModel.create(wsDocId, { visibility: 'private' });

        const result = await DocumentShareModel.findByDocumentIdWithAccessCheck(
          serverDB,
          wsDocId,
          userId,
        );

        expect(result.document.id).toBe(wsDocId);
        expect(result.isOwner).toBe(true);
      });

      it('rejects a member for a workspace-PRIVATE doc private share (row visibility wins)', async () => {
        const privDocId = 'doc-share-ws-priv-doc';
        await serverDB.insert(documents).values({
          id: privDocId,
          title: 'WS Private Doc',
          userId,
          visibility: 'private',
          workspaceId,
          ...baseDocFields,
        });
        const privShareModel = new DocumentShareModel(serverDB, userId, workspaceId);
        await privShareModel.create(privDocId, { visibility: 'private' });

        try {
          await DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, privDocId, userId2);
          throw new Error('should not reach');
        } catch (error) {
          expect((error as TRPCError).code).toBe('FORBIDDEN');
        }
      });

      it('rejects anonymous access for a private workspace share', async () => {
        await wsShareModel.create(wsDocId, { visibility: 'private' });

        try {
          await DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, wsDocId, undefined);
          throw new Error('should not reach');
        } catch (error) {
          expect((error as TRPCError).code).toBe('FORBIDDEN');
        }
      });

      it('rejects a non-member for a private workspace share', async () => {
        const outsiderId = 'doc-share-outsider';
        await serverDB.insert(users).values({ id: outsiderId });
        await wsShareModel.create(wsDocId, { visibility: 'private' });

        try {
          await DocumentShareModel.findByDocumentIdWithAccessCheck(serverDB, wsDocId, outsiderId);
          throw new Error('should not reach');
        } catch (error) {
          expect((error as TRPCError).code).toBe('FORBIDDEN');
        }
      });
    });
  });
});
