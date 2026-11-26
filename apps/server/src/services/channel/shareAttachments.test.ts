// @vitest-environment node
import { SHARE_VISITOR_MAX_FILE_SIZE, SHARE_VISITOR_MAX_FILES_PER_TURN } from '@lobechat/const';
import { getTestDB } from '@lobechat/database/test-utils';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agents, agentShares, files, users } from '@/database/schemas';

import {
  importShareAttachments,
  readVisitorFiles,
  shareAttachmentLimitType,
  ShareAttachmentRefusal,
} from './shareAttachments';

const s3 = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  getFileByteArray: vi.fn(),
  uploadBuffer: vi.fn(),
}));
const uploadCheck = vi.hoisted(() => vi.fn());
vi.mock('@/business/server/lambda-routers/file', () => ({ businessFileUploadCheck: uploadCheck }));
vi.mock('@/server/modules/S3', () => ({
  FileS3: class {
    deleteFile = s3.deleteFile;
    getFileByteArray = s3.getFileByteArray;
    uploadBuffer = s3.uploadBuffer;
  },
}));

const db = await getTestDB();
const ownerId = 'share-attach-owner';
const visitorId = 'share-attach-visitor';
const strangerId = 'share-attach-stranger';
const agentId = 'agt_share_attach';
const sourceId = 'file_share_attach_src';
let shareId: string;

const source = {
  fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  id: sourceId,
  name: 'slides.pptx',
  size: 4,
  url: `files/${visitorId}/slides.pptx`,
};

const target = (maxFileStorage?: number) => ({
  agentId,
  maxFileStorage,
  ownerId,
  shareId,
  visitorUserId: visitorId,
  workspaceId: null,
});

const shareCopies = () => db.select().from(files).where(eq(files.userId, ownerId));

beforeEach(async () => {
  vi.resetAllMocks();
  s3.getFileByteArray.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  s3.uploadBuffer.mockResolvedValue({});
  s3.deleteFile.mockResolvedValue(undefined);
  uploadCheck.mockResolvedValue(undefined);
  await db.insert(users).values([{ id: ownerId }, { id: visitorId }, { id: strangerId }]);
  await db.insert(agents).values({ id: agentId, title: 'Shared', userId: ownerId });
  const [share] = await db
    .insert(agentShares)
    .values({ agentId, shareConfig: { monthlySpendLimit: 1, slug: 'attach' }, visibility: 'link' })
    .returning();
  shareId = share.id;
  await db.insert(files).values([
    { ...source, userId: visitorId },
    {
      fileType: 'text/plain',
      id: 'file_share_attach_other',
      name: 'other.txt',
      size: 1,
      url: 'files/other.txt',
      userId: strangerId,
    },
  ]);
});

afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [ownerId, visitorId, strangerId]));
});

describe('readVisitorFiles', () => {
  it('returns only the visitor’s own files, in the order they were attached', async () => {
    const rows = await readVisitorFiles(db, visitorId, [
      'file_share_attach_other',
      sourceId,
      sourceId,
    ]);

    expect(rows.map((row) => row.id)).toEqual([sourceId]);
  });
});

describe('shareAttachmentLimitType', () => {
  it('admits a turn within the share page’s bounds', () => {
    expect(shareAttachmentLimitType([[{ size: 1 }]])).toBeUndefined();
    expect(shareAttachmentLimitType([[], []], 0)).toBeUndefined();
  });

  it('refuses a message with too many files or a file too large', () => {
    const files = (length: number) => Array.from({ length }, () => ({ size: 1 }));
    expect(shareAttachmentLimitType([files(SHARE_VISITOR_MAX_FILES_PER_TURN + 1)])).toBe(
      ChatErrorType.ShareAttachmentTooLarge,
    );
    expect(shareAttachmentLimitType([[{ size: SHARE_VISITOR_MAX_FILE_SIZE + 1 }]])).toBe(
      ChatErrorType.ShareAttachmentTooLarge,
    );
  });

  it('counts files per message, so a quoted message’s files do not push the reply over', () => {
    const files = (length: number) => Array.from({ length }, () => ({ size: 1 }));
    expect(
      shareAttachmentLimitType([files(SHARE_VISITOR_MAX_FILES_PER_TURN), files(1)]),
    ).toBeUndefined();
  });

  it('refuses any file once the creator turned visitor attachments off', () => {
    expect(shareAttachmentLimitType([[{ size: 1 }]], 0)).toBe(
      ChatErrorType.ShareFileStorageExceeded,
    );
  });
});

describe('importShareAttachments', () => {
  it('copies the visitor’s file into the share, readable only through the share’s scope', async () => {
    const [id] = await importShareAttachments(db, target(), [source]);

    const [copy] = await shareCopies();
    expect(copy.id).toBe(id);
    expect(
      copy.url.startsWith(`files/${ownerId}/agent-share/${shareId}/channel/${sourceId}/`),
    ).toBe(true);
    expect(copy.metadata).toMatchObject({ agentShare: { shareId, visitorUserId: visitorId } });
    // Outside the hash-keyed dedup graph, like every share upload.
    expect(copy.fileHash).toBeNull();
    expect(copy.size).toBe(4);
    expect(s3.getFileByteArray).toHaveBeenCalledWith(source.url);
    expect(s3.uploadBuffer).toHaveBeenCalledWith(copy.url, expect.any(Buffer), source.fileType);
  });

  it('reuses its copy when the same reply is dispatched again', async () => {
    const [first] = await importShareAttachments(db, target(), [source]);
    const [second] = await importShareAttachments(db, target(), [source]);

    expect(second).toBe(first);
    expect(await shareCopies()).toHaveLength(1);
    expect(s3.uploadBuffer).toHaveBeenCalledOnce();
  });

  it('refuses a turn that cannot fit before transferring anything', async () => {
    await expect(importShareAttachments(db, target(3), [source])).rejects.toEqual(
      new ShareAttachmentRefusal(ChatErrorType.ShareFileStorageExceeded),
    );

    expect(await shareCopies()).toHaveLength(0);
    expect(s3.getFileByteArray).not.toHaveBeenCalled();
    expect(s3.uploadBuffer).not.toHaveBeenCalled();
  });

  it('refuses a copy whose actual bytes exceed the share’s storage and removes its object', async () => {
    // The recorded size passes the early check; the copied bytes do not.
    await expect(importShareAttachments(db, target(3), [{ ...source, size: 1 }])).rejects.toEqual(
      new ShareAttachmentRefusal(ChatErrorType.ShareFileStorageExceeded),
    );

    expect(await shareCopies()).toHaveLength(0);
    expect(s3.deleteFile).toHaveBeenCalledWith(s3.uploadBuffer.mock.calls[0][0]);
  });

  it('leaves none of a turn’s copies behind when a later file does not fit', async () => {
    // Recorded as 1 byte, so the turn passes the early check and fails while settling.
    const second = {
      ...source,
      id: 'file_share_attach_src2',
      name: 'notes.pptx',
      size: 1,
      url: 'files/v/n',
    };
    await db.insert(files).values({ ...second, userId: visitorId });

    // Room for the first 4-byte copy, not the second.
    await expect(importShareAttachments(db, target(6), [source, second])).rejects.toEqual(
      new ShareAttachmentRefusal(ChatErrorType.ShareFileStorageExceeded),
    );

    expect(await shareCopies()).toHaveLength(0);
    expect(s3.deleteFile.mock.calls.map(([key]) => key).sort()).toEqual(
      s3.uploadBuffer.mock.calls.map(([key]) => key).sort(),
    );
  });

  it('reads the creator’s storage block as the share’s storage being full', async () => {
    uploadCheck.mockRejectedValue(
      new TRPCError({ code: 'FORBIDDEN', message: 'storage_block:subscription_inactive' }),
    );

    await expect(importShareAttachments(db, target(), [source])).rejects.toEqual(
      new ShareAttachmentRefusal(ChatErrorType.ShareFileStorageExceeded),
    );
  });

  it('keeps any other upload-check failure as its own cause', async () => {
    uploadCheck.mockRejectedValue(new Error('billing service unavailable'));

    await expect(importShareAttachments(db, target(), [source])).rejects.toThrow(
      'billing service unavailable',
    );
    expect(await shareCopies()).toHaveLength(0);
  });

  it('removes an object whose upload failed after it may have been stored', async () => {
    s3.uploadBuffer.mockRejectedValue(new Error('upload timed out'));

    await expect(importShareAttachments(db, target(), [source])).rejects.toThrow(
      'upload timed out',
    );

    expect(s3.deleteFile).toHaveBeenCalledWith(s3.uploadBuffer.mock.calls[0][0]);
    expect(await shareCopies()).toHaveLength(0);
  });

  it('reports cleanup that leaves an object behind', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    s3.uploadBuffer.mockRejectedValue(new Error('upload timed out'));
    s3.deleteFile.mockRejectedValue(new Error('delete failed'));

    await expect(importShareAttachments(db, target(), [source])).rejects.toThrow(
      'upload timed out',
    );

    expect(error).toHaveBeenCalledWith(
      '[channel:share-attachments] cleanup left unreferenced objects',
      { failed: 1, shareId },
    );
    error.mockRestore();
  });

  it('writes nothing once the share is paused', async () => {
    await db.update(agentShares).set({ visibility: 'private' }).where(eq(agentShares.id, shareId));

    await expect(importShareAttachments(db, target(), [source])).rejects.toThrow(
      'This Agent is no longer shared',
    );
    expect(await shareCopies()).toHaveLength(0);
    expect(s3.deleteFile).toHaveBeenCalledOnce();
  });
});
