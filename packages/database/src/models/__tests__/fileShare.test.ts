// @vitest-environment node
import type { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { files, fileShares, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileShareModel } from '../fileShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-share-test-user-id';
const userId2 = 'file-share-test-user-id-2';
const fileId = 'file-share-test-file';
const fileId2User2 = 'file-share-test-file-user2';

const shareModel = new FileShareModel(serverDB, userId);
const shareModelOther = new FileShareModel(serverDB, userId2);

const baseFileFields = { fileType: 'application/pdf', size: 2048, url: 'files/report.pdf' };

const expectTRPCCode = async (promise: Promise<unknown>, code: TRPCError['code']) => {
  await expect(promise).rejects.toMatchObject({ code });
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
  await serverDB.insert(files).values([
    { id: fileId, name: 'report.pdf', userId, ...baseFileFields },
    { id: fileId2User2, name: 'other.pdf', userId: userId2, ...baseFileFields },
  ]);
});

afterEach(async () => {
  await serverDB.delete(fileShares);
  await serverDB.delete(files);
  await serverDB.delete(users);
});

describe('FileShareModel', () => {
  describe('create', () => {
    it('creates a private share owned by the file creator by default', async () => {
      const result = await shareModel.create(fileId);

      expect(result).toMatchObject({ fileId, userId, visibility: 'private' });
      expect(result!.id).toHaveLength(16);
    });

    it('creates a link share', async () => {
      const result = await shareModel.create(fileId, 'link');
      expect(result!.visibility).toBe('link');
    });

    it('throws when the file does not exist', async () => {
      await expect(shareModel.create('missing')).rejects.toThrow(
        'File not found or not owned by user',
      );
    });

    it('throws when the file belongs to another user', async () => {
      await expect(shareModel.create(fileId2User2)).rejects.toThrow(
        'File not found or not owned by user',
      );
    });

    it('returns the existing share on duplicate create', async () => {
      const first = await shareModel.create(fileId, 'link');
      const second = await shareModel.create(fileId);

      expect(second!.id).toBe(first!.id);
      expect(second!.visibility).toBe('link');
    });
  });

  describe('updateVisibility', () => {
    it('updates the visibility of an own share', async () => {
      await shareModel.create(fileId);

      const updated = await shareModel.updateVisibility(fileId, 'link');
      expect(updated!.visibility).toBe('link');
    });

    it('returns null when no share exists', async () => {
      expect(await shareModel.updateVisibility(fileId, 'link')).toBeNull();
    });

    it('does not change another user share', async () => {
      await shareModel.create(fileId);

      expect(await shareModelOther.updateVisibility(fileId, 'link')).toBeNull();
      expect((await shareModel.getByFileId(fileId))!.visibility).toBe('private');
    });
  });

  describe('deleteByFileId', () => {
    it('deletes an own share', async () => {
      await shareModel.create(fileId);
      await shareModel.deleteByFileId(fileId);

      expect(await shareModel.getByFileId(fileId)).toBeNull();
    });

    it('does not delete another user share', async () => {
      await shareModel.create(fileId);
      await shareModelOther.deleteByFileId(fileId);

      expect(await shareModel.getByFileId(fileId)).not.toBeNull();
    });
  });

  describe('getByFileId', () => {
    it('returns the share for its owner', async () => {
      const created = await shareModel.create(fileId, 'link');

      expect(await shareModel.getByFileId(fileId)).toMatchObject({
        fileId,
        id: created!.id,
        pageViewCount: 0,
        visibility: 'link',
      });
    });

    it('does not leak the share to another user', async () => {
      await shareModel.create(fileId, 'link');
      expect(await shareModelOther.getByFileId(fileId)).toBeNull();
    });
  });

  describe('findByShareIdWithAccessCheck (static)', () => {
    it('lets the owner read a private share', async () => {
      const share = await shareModel.create(fileId);

      const result = await FileShareModel.findByShareIdWithAccessCheck(serverDB, share!.id, userId);
      expect(result).toMatchObject({
        fileId,
        fileType: 'application/pdf',
        name: 'report.pdf',
        ownerId: userId,
        size: 2048,
        url: 'files/report.pdf',
      });
    });

    it('rejects anyone else for a private share', async () => {
      const share = await shareModel.create(fileId);

      await expectTRPCCode(
        FileShareModel.findByShareIdWithAccessCheck(serverDB, share!.id, userId2),
        'FORBIDDEN',
      );
      await expectTRPCCode(
        FileShareModel.findByShareIdWithAccessCheck(serverDB, share!.id),
        'FORBIDDEN',
      );
    });

    it('lets an anonymous viewer read a link share', async () => {
      const share = await shareModel.create(fileId, 'link');

      const result = await FileShareModel.findByShareIdWithAccessCheck(serverDB, share!.id);
      expect(result.fileId).toBe(fileId);
    });

    it('throws NOT_FOUND for an unknown share id', async () => {
      await expectTRPCCode(
        FileShareModel.findByShareIdWithAccessCheck(serverDB, 'missing'),
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND once the file is in the recycle bin', async () => {
      const share = await shareModel.create(fileId, 'link');
      await serverDB
        .update(files)
        .set({ deletedAt: new Date(), isDeleted: true })
        .where(eq(files.id, fileId));

      await expectTRPCCode(
        FileShareModel.findByShareIdWithAccessCheck(serverDB, share!.id),
        'NOT_FOUND',
      );
    });
  });

  describe('incrementViewCount (static)', () => {
    it('increments the page view count', async () => {
      const share = await shareModel.create(fileId, 'link');

      await FileShareModel.incrementViewCount(serverDB, share!.id);
      await FileShareModel.incrementViewCount(serverDB, share!.id);

      expect((await shareModel.getByFileId(fileId))!.pageViewCount).toBe(2);
    });
  });

  it('deletes the share together with its file', async () => {
    await shareModel.create(fileId);
    await serverDB.delete(files).where(eq(files.id, fileId));

    expect(await serverDB.select().from(fileShares)).toHaveLength(0);
  });

  describe('workspace mode', () => {
    const workspaceId = 'file-share-ws';
    const wsFileId = 'file-share-ws-file';
    let wsShareModel: FileShareModel;

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'File Share WS',
        primaryOwnerId: userId,
        slug: 'file-share-ws',
      });
      await serverDB
        .insert(files)
        .values({ id: wsFileId, name: 'ws.pdf', userId, workspaceId, ...baseFileFields });
      wsShareModel = new FileShareModel(serverDB, userId, workspaceId);
    });

    it('scopes the share to the workspace', async () => {
      const share = await wsShareModel.create(wsFileId);
      expect(share!.workspaceId).toBe(workspaceId);
    });

    it('still finds the share after switching visibility to link', async () => {
      await wsShareModel.create(wsFileId);
      await wsShareModel.updateVisibility(wsFileId, 'link');

      // file_shares.visibility is share semantics ('private' | 'link') and must
      // not be fed into the workspace row-visibility filter.
      expect((await wsShareModel.getByFileId(wsFileId))!.visibility).toBe('link');
    });

    it('does not see the workspace share from personal scope', async () => {
      await wsShareModel.create(wsFileId);
      expect(await shareModel.getByFileId(wsFileId)).toBeNull();
    });
  });
});
