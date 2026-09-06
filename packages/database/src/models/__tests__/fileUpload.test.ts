// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { files, fileUploads, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileUploadModel } from '../fileUpload';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-upload-test-user';
const otherUserId = 'file-upload-test-other-user';
const workspaceId = 'file-upload-test-workspace';

const expiresAt = new Date('2030-01-01T00:00:00Z');

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'File upload test',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('FileUploadModel', () => {
  it('scopes sessions and counts only live bytes in the matching quota scope', async () => {
    const personal = new FileUploadModel(serverDB, userId);
    const other = new FileUploadModel(serverDB, otherUserId);
    const workspace = new FileUploadModel(serverDB, userId, workspaceId);

    const upload = await personal.create({ expiresAt, pathname: 'files/personal', size: 10 });
    await other.create({ expiresAt, pathname: 'files/other', size: 20 });
    await workspace.create({ expiresAt, pathname: 'files/workspace', size: 30 });

    expect(await personal.countLiveUsage()).toBe(10);
    expect(await other.countLiveUsage()).toBe(20);
    expect(await workspace.countLiveUsage()).toBe(30);
    expect(await FileUploadModel.countLiveUsageForWorkspace(serverDB, workspaceId)).toBe(30);
    expect(await FileUploadModel.hasLivePathname(serverDB, upload!.pathname)).toBe(true);
    expect(await FileUploadModel.hasLivePathname(serverDB, 'files/missing')).toBe(false);
    expect(await other.findActiveByPathname(upload!.pathname)).toBeUndefined();

    const touched = await personal.touchActive(upload!.pathname, new Date('2031-01-01T00:00:00Z'));
    expect(touched?.expiresAt).toEqual(new Date('2031-01-01T00:00:00Z'));

    const attached = await personal.attachMultipartUpload(upload!.id, 'multipart-1');
    expect(attached?.multipartUploadId).toBe('multipart-1');
    expect((await personal.markCompleted(upload!.id))?.completedAt).toBeInstanceOf(Date);

    const claimed = await serverDB.transaction((transaction) =>
      personal.claimActiveForCleanup(upload!.pathname, transaction),
    );
    expect(claimed?.status).toBe('cleaning');
    expect(await personal.countLiveUsage()).toBe(10);
    expect((await personal.markReleased(upload!.id))?.status).toBe('released');
    expect(await personal.countLiveUsage()).toBe(0);
    expect(await FileUploadModel.hasLivePathname(serverDB, upload!.pathname)).toBe(false);
  });

  it('settles a locked active reservation exactly once', async () => {
    const model = new FileUploadModel(serverDB, userId);
    const upload = await model.create({ expiresAt, pathname: 'files/settle', size: 8 });
    const [file] = await serverDB
      .insert(files)
      .values({ fileType: 'text/plain', name: 'settled.txt', size: 8, url: 'files/settle', userId })
      .returning();

    const settled = await serverDB.transaction(async (transaction) => {
      const locked = await model.findLatestByPathnameForUpdate(upload!.pathname, transaction);
      expect(locked?.id).toBe(upload!.id);
      return model.settle(upload!.id, file.id, transaction);
    });

    expect(settled).toMatchObject({ fileId: file.id, status: 'settled' });
    expect(await model.countLiveUsage()).toBe(0);
    await expect(
      serverDB.transaction((transaction) => model.settle(upload!.id, file.id, transaction)),
    ).resolves.toBeUndefined();
  });

  it('claims only expired work and garbage-collects only old terminal rows in batches', async () => {
    const model = new FileUploadModel(serverDB, userId);
    const old = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:00:00Z');
    const future = new Date('2027-01-01T00:00:00Z');

    const expired = await model.create({ expiresAt: old, pathname: 'files/expired', size: 1 });
    const live = await model.create({ expiresAt: future, pathname: 'files/live', size: 2 });
    const staleCleaning = await model.create({
      expiresAt: future,
      pathname: 'files/stale-cleaning',
      size: 3,
    });
    await serverDB.transaction((transaction) =>
      model.claimActiveForCleanup(staleCleaning!.pathname, transaction),
    );
    await serverDB
      .update(fileUploads)
      .set({ updatedAt: old })
      .where(eq(fileUploads.id, staleCleaning!.id));

    const recentCleaning = await model.create({
      expiresAt: future,
      pathname: 'files/recent-cleaning',
      size: 4,
    });
    await serverDB.transaction((transaction) =>
      model.claimActiveForCleanup(recentCleaning!.pathname, transaction),
    );

    const claimed = await FileUploadModel.claimExpiredBatch(serverDB, {
      batchSize: 10,
      cleanupLeaseBefore: new Date('2025-06-01T00:00:00Z'),
      expiresBefore: now,
    });
    expect(new Set(claimed.map(({ id }) => id))).toEqual(new Set([expired!.id, staleCleaning!.id]));

    await FileUploadModel.markExpired(serverDB, expired!.id);
    await FileUploadModel.markExpired(serverDB, staleCleaning!.id);
    await serverDB
      .update(fileUploads)
      .set({ updatedAt: old })
      .where(eq(fileUploads.id, expired!.id));

    expect(
      await FileUploadModel.deleteTerminalBatch(serverDB, {
        batchSize: 1,
        updatedBefore: now,
      }),
    ).toBe(1);
    expect(
      await serverDB
        .select({ id: fileUploads.id })
        .from(fileUploads)
        .where(and(eq(fileUploads.id, expired!.id), eq(fileUploads.status, 'expired'))),
    ).toHaveLength(0);
    expect(await model.findActiveByPathname(live!.pathname)).toBeDefined();
    expect((await model.findLatestByPathname(recentCleaning!.pathname))?.status).toBe('cleaning');
  });
});
