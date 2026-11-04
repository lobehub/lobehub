// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { files, globalFiles, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-usage-user';
const otherUserId = 'file-usage-other';
const workspaceId = 'file-usage-workspace';

const fileModel = new FileModel(serverDB, userId);

const seedGlobalFile = async (hashId: string, url: string, size: number) => {
  await serverDB
    .insert(globalFiles)
    .values({ creator: userId, fileType: 'application/pdf', hashId, size, url });
};

const seedFile = async (
  id: string,
  {
    fileHash,
    metadata,
    ownerId = userId,
    size,
    url,
    workspaceId: fileWorkspaceId,
  }: {
    fileHash?: string;
    metadata?: Record<string, unknown>;
    ownerId?: string;
    size: number;
    url: string;
    workspaceId?: string;
  },
) => {
  await serverDB.insert(files).values({
    fileHash,
    fileType: 'application/pdf',
    id,
    metadata,
    name: `${id}.pdf`,
    size,
    url,
    userId: ownerId,
    workspaceId: fileWorkspaceId,
  });
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(globalFiles);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Usage', primaryOwnerId: userId, slug: 'file-usage' });
});

afterEach(async () => {
  await serverDB.delete(files);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
  await serverDB.delete(globalFiles);
});

describe('FileModel.countUsage', () => {
  it('counts one stored object once when several file rows reference it', async () => {
    await seedGlobalFile('hash-a', 'files/a.pdf', 1000);
    await seedFile('file-a-1', { fileHash: 'hash-a', size: 1000, url: 'files/a.pdf' });
    await seedFile('file-a-2', { fileHash: 'hash-a', size: 1000, url: 'files/a.pdf' });
    await seedFile('file-a-3', { fileHash: 'hash-a', size: 1000, url: 'files/a.pdf' });

    await expect(fileModel.countUsage()).resolves.toBe(1000);
  });

  it('counts every row without a hash on its own', async () => {
    await seedFile('file-no-hash-1', { size: 100, url: 'files/same.pdf' });
    await seedFile('file-no-hash-2', { size: 200, url: 'files/same.pdf' });

    await expect(fileModel.countUsage()).resolves.toBe(300);
  });

  it('counts distinct objects that claim the same hash separately', async () => {
    // The hash is supplied by the uploading client, so it alone cannot prove two rows share
    // storage: two different objects claiming one hash must both count toward the quota.
    await seedGlobalFile('hash-a', 'files/a.pdf', 1000);
    await seedFile('file-a', { fileHash: 'hash-a', size: 1000, url: 'files/a.pdf' });
    await seedFile('file-forged', { fileHash: 'hash-a', size: 5000, url: 'files/other.pdf' });

    await expect(fileModel.countUsage()).resolves.toBe(6000);
  });

  it("keeps each owner's usage separate for a shared object", async () => {
    await seedGlobalFile('hash-a', 'files/a.pdf', 1000);
    await seedFile('file-mine', { fileHash: 'hash-a', size: 1000, url: 'files/a.pdf' });
    await seedFile('file-mine-copy', { fileHash: 'hash-a', size: 1000, url: 'files/a.pdf' });
    await seedFile('file-other', {
      fileHash: 'hash-a',
      ownerId: otherUserId,
      size: 1000,
      url: 'files/a.pdf',
    });
    await seedFile('file-workspace', {
      fileHash: 'hash-a',
      size: 1000,
      url: 'files/a.pdf',
      workspaceId,
    });
    await seedFile('file-workspace-copy', {
      fileHash: 'hash-a',
      ownerId: otherUserId,
      size: 1000,
      url: 'files/a.pdf',
      workspaceId,
    });

    await expect(fileModel.countUsage()).resolves.toBe(1000);
    await expect(new FileModel(serverDB, otherUserId).countUsage()).resolves.toBe(1000);
    await expect(new FileModel(serverDB, userId, workspaceId).countUsage()).resolves.toBe(1000);
  });

  it('returns 0 when the owner has no files', async () => {
    await expect(fileModel.countUsage()).resolves.toBe(0);
  });
});

describe('FileModel.countAgentShareUsage', () => {
  const shareMetadata = (shareId: string) => ({
    agentShare: { shareId, visitorUserId: 'visitor' },
  });

  it('counts a shared stored object once per share', async () => {
    await seedGlobalFile('hash-a', 'files/a.pdf', 1000);
    await seedFile('share-a-1', {
      fileHash: 'hash-a',
      metadata: shareMetadata('share-a'),
      size: 1000,
      url: 'files/a.pdf',
    });
    await seedFile('share-a-2', {
      fileHash: 'hash-a',
      metadata: shareMetadata('share-a'),
      size: 1000,
      url: 'files/a.pdf',
    });
    await seedFile('share-a-no-hash', {
      metadata: shareMetadata('share-a'),
      size: 50,
      url: 'files/visitor.pdf',
    });
    await seedFile('share-b', {
      fileHash: 'hash-a',
      metadata: shareMetadata('share-b'),
      size: 1000,
      url: 'files/a.pdf',
    });

    await expect(fileModel.countAgentShareUsage('share-a')).resolves.toBe(1050);
    await expect(fileModel.countAgentShareUsage('share-b')).resolves.toBe(1000);
  });
});
