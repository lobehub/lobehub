// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewFile } from '../../schemas';
import { files, globalFiles, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-usage-user';
const fileModel = new FileModel(serverDB, userId);

const row = (file: Pick<NewFile, 'fileHash' | 'size' | 'url'> & Partial<NewFile>): NewFile => ({
  fileType: 'application/octet-stream',
  name: 'file',
  userId,
  ...file,
});

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  // `files.file_hash` references `global_files`.
  await serverDB
    .insert(globalFiles)
    .values(
      ['h1', 'h2', 'd1', 'v1', 'v2'].map((hashId) => ({
        creator: userId,
        fileType: 'application/octet-stream',
        hashId,
        size: 1,
        url: `global/${hashId}`,
      })),
    )
    .onConflictDoNothing();
});

afterEach(async () => {
  await serverDB.delete(files).where(eq(files.userId, userId));
  await serverDB.delete(workspaces).where(eq(workspaces.primaryOwnerId, userId));
  await serverDB.delete(globalFiles).where(eq(globalFiles.creator, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('FileModel.countUsage', () => {
  it('counts one stored object once however many rows point at it', async () => {
    await serverDB.insert(files).values([
      // The same upload added twice reuses one object.
      row({ fileHash: 'h1', size: 1000, url: 'files/u/h1.png' }),
      row({ fileHash: 'h1', size: 1000, url: 'files/u/h1.png' }),
      // One Canvas blob used by two canvases.
      row({
        fileHash: 'h2',
        metadata: { canvasId: 'cvs_a' },
        size: 300,
        source: 'canvas',
        url: 'canvas/u/blobs/h2',
      }),
      row({
        fileHash: 'h2',
        metadata: { canvasId: 'cvs_b' },
        size: 300,
        source: 'canvas',
        url: 'canvas/u/blobs/h2',
      }),
    ]);

    expect(await fileModel.countUsage()).toBe(1300);
  });

  it('still counts rows that do not share one stored object', async () => {
    await serverDB.insert(files).values([
      // Inline documents share a placeholder url but hold their own content.
      row({ fileHash: 'd1', size: 10, url: 'internal://document/placeholder' }),
      row({ fileHash: 'd1', size: 10, url: 'internal://document/placeholder' }),
      // A path rewritten with new content.
      row({ fileHash: 'v1', size: 20, url: 'exports/report.csv' }),
      row({ fileHash: 'v2', size: 30, url: 'exports/report.csv' }),
      // Rows without a hash cannot be matched to an object.
      row({ fileHash: null, size: 40, url: 'files/u/legacy.txt' }),
      row({ fileHash: null, size: 40, url: 'files/u/legacy.txt' }),
    ]);

    expect(await fileModel.countUsage()).toBe(10 + 10 + 20 + 30 + 40 + 40);
  });

  it('counts the largest size when rows of one object disagree', async () => {
    await serverDB
      .insert(files)
      .values([
        row({ fileHash: 'h1', size: 20, url: 'files/u/h1.png' }),
        row({ fileHash: 'h1', size: 3000, url: 'files/u/h1.png' }),
        row({ fileHash: 'h1', size: 500, url: 'files/u/h1.png' }),
      ]);

    expect(await fileModel.countUsage()).toBe(3000);
  });

  it('scopes a workspace sum to that workspace', async () => {
    const [a, b] = await serverDB
      .insert(workspaces)
      .values([
        { name: 'usage-a', primaryOwnerId: userId, slug: 'file-usage-a' },
        { name: 'usage-b', primaryOwnerId: userId, slug: 'file-usage-b' },
      ])
      .returning();
    await serverDB
      .insert(files)
      .values([
        row({ fileHash: 'h1', size: 1000, url: 'files/u/h1.png', workspaceId: a.id }),
        row({ fileHash: 'h1', size: 1000, url: 'files/u/h1.png', workspaceId: a.id }),
        row({ fileHash: 'h1', size: 1000, url: 'files/u/h1.png', workspaceId: b.id }),
        row({ fileHash: 'h2', size: 300, url: 'files/u/h2.png' }),
      ]);

    // Each workspace counts the shared object once; personal rows stay out.
    expect(await FileModel.sumStorageBytes(serverDB, eq(files.workspaceId, a.id))).toBe(1000);
    expect(await FileModel.sumStorageBytes(serverDB, eq(files.workspaceId, b.id))).toBe(1000);
    expect(await fileModel.countUsage()).toBe(300);
  });
});

describe('FileModel added storage bytes', () => {
  const createWorkspace = async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'usage-target', primaryOwnerId: userId, slug: 'file-usage-target' })
      .returning();
    return workspace;
  };

  it('adds nothing for a new row of an object the space already stores', async () => {
    await serverDB.insert(files).values(row({ fileHash: 'h1', size: 1000, url: 'files/u/h1.png' }));
    const target = { userId };

    // A renamed re-upload of the same bytes.
    expect(
      await FileModel.addedStorageBytesForObject(serverDB, target, {
        fileHash: 'h1',
        size: 1000,
        url: 'files/u/h1.png',
      }),
    ).toBe(0);
    // A new object, and an object the space does not store yet.
    expect(
      await FileModel.addedStorageBytesForObject(serverDB, target, {
        fileHash: 'h2',
        size: 300,
        url: 'files/u/h2.png',
      }),
    ).toBe(300);
    // Rows without a hash cannot be matched to an object.
    expect(
      await FileModel.addedStorageBytesForObject(serverDB, target, {
        fileHash: null,
        size: 40,
        url: 'files/u/h1.png',
      }),
    ).toBe(40);
  });

  it('adds only the objects the target does not store yet, each once', async () => {
    const workspace = await createWorkspace();
    const [stored, sharedA, sharedB, legacy] = await serverDB
      .insert(files)
      .values([
        row({ fileHash: 'h1', size: 1000, url: 'files/u/h1.png' }),
        row({ fileHash: 'h2', size: 300, url: 'files/u/h2.png' }),
        row({ fileHash: 'h2', size: 300, url: 'files/u/h2.png' }),
        row({ fileHash: null, size: 40, url: 'files/u/legacy.txt' }),
      ])
      .returning();
    await serverDB
      .insert(files)
      .values(
        row({ fileHash: 'h1', size: 1000, url: 'files/u/h1.png', workspaceId: workspace.id }),
      );
    const target = { userId, workspaceId: workspace.id };

    expect(await FileModel.sumAddedStorageBytes(serverDB, target, [stored.id])).toBe(0);
    expect(
      await FileModel.sumAddedStorageBytes(serverDB, target, [
        stored.id,
        sharedA.id,
        sharedB.id,
        legacy.id,
      ]),
    ).toBe(300 + 40);
    expect(await FileModel.sumAddedStorageBytes(serverDB, target, [])).toBe(0);
  });
});
