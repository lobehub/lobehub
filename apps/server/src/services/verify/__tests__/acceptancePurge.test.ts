// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import {
  acceptances,
  files,
  globalFiles,
  users,
  verifyCheckResults,
  verifyEvidence,
  verifyRuns,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { FileSource } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileService } from '@/server/services/file';

import { previewAcceptancePurge, purgeAcceptance, purgeVerifyRun } from '../acceptancePurge';

const envMock = vi.hoisted(() => ({ serverDBEnv: { REMOVE_GLOBAL_FILE: true } }));
vi.mock('@/config/db', () => envMock);

const createTestUser = async (db: LobeChatDatabase) => {
  const id = randomUUID();
  await db.insert(users).values({ id });
  return id;
};

const cleanupTestUser = async (db: LobeChatDatabase, id: string) => {
  await db.delete(users).where(eq(users.id, id));
};

describe('acceptancePurge', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let acceptanceId: string;
  let runIds: string[];
  let fileIds: string[];
  let keeperFileId: string;
  let SHARED_HASH: string;
  let SOLO_HASH: string;
  let PAIR_HASH: string;
  const fileService = { deleteFiles: vi.fn() } as unknown as FileService;

  const seedRound = async (targetAcceptanceId: string, roundIndex: number, fileIds: string[]) => {
    const [run] = await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId: targetAcceptanceId, roundIndex, userId })
      .returning();
    const [result] = await serverDB
      .insert(verifyCheckResults)
      .values({ checkItemId: 'c1', userId, verifierType: 'agent', verifyRunId: run.id })
      .returning();
    await serverDB.insert(verifyEvidence).values(
      fileIds.map((fileId) => ({
        checkResultId: result.id,
        fileId,
        type: 'screenshot' as const,
        userId,
      })),
    );
    return run.id;
  };

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    vi.mocked(fileService.deleteFiles).mockReset();
    envMock.serverDBEnv.REMOVE_GLOBAL_FILE = true;
    SHARED_HASH = randomUUID().replaceAll('-', '');
    SOLO_HASH = randomUUID().replaceAll('-', '');
    PAIR_HASH = randomUUID().replaceAll('-', '');

    await serverDB.insert(globalFiles).values([
      { creator: userId, fileType: 'image/png', hashId: SHARED_HASH, size: 500, url: 'shared.png' },
      { creator: userId, fileType: 'video/mp4', hashId: SOLO_HASH, size: 900, url: 'solo.mp4' },
    ]);
    const inserted = await serverDB
      .insert(files)
      .values([
        {
          fileHash: SHARED_HASH,
          fileType: 'image/png',
          name: 'a.png',
          size: 500,
          source: FileSource.Acceptance,
          url: 'shared.png',
          userId,
        },
        {
          fileHash: SHARED_HASH,
          fileType: 'image/png',
          name: 'b.png',
          size: 500,
          source: FileSource.Acceptance,
          url: 'shared.png',
          userId,
        },
        {
          fileHash: SOLO_HASH,
          fileType: 'video/mp4',
          name: 'c.mp4',
          size: 900,
          source: FileSource.Acceptance,
          url: 'solo.mp4',
          userId,
        },
        {
          fileHash: SHARED_HASH,
          fileType: 'image/png',
          name: 'keeper.png',
          size: 500,
          url: 'shared.png',
          userId,
        },
      ])
      .returning({ id: files.id });
    fileIds = inserted.slice(0, 3).map((f) => f.id);
    keeperFileId = inserted[3].id;

    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: randomUUID(), subjectType: 'standalone', userId })
      .returning();
    acceptanceId = acceptance.id;
    runIds = [
      await seedRound(acceptanceId, 1, [fileIds[0], fileIds[1]]),
      await seedRound(acceptanceId, 2, [fileIds[2]]),
    ];
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    await serverDB
      .delete(globalFiles)
      .where(inArray(globalFiles.hashId, [SHARED_HASH, SOLO_HASH, PAIR_HASH]));
  });

  const seedFile = async (values: Partial<typeof files.$inferInsert>) => {
    const [row] = await serverDB
      .insert(files)
      .values({
        fileType: 'text/plain',
        name: 'x.log',
        size: 100,
        source: FileSource.Acceptance,
        url: `${randomUUID()}.log`,
        userId,
        ...values,
      })
      .returning({ id: files.id });
    return row.id;
  };

  const seedAcceptance = async () => {
    const [row] = await serverDB
      .insert(acceptances)
      .values({ subjectId: randomUUID(), subjectType: 'standalone', userId })
      .returning();
    return row.id;
  };

  it('previews rounds and file counts, and only counts bytes of objects that will be freed', async () => {
    await expect(
      previewAcceptancePurge(serverDB, userId, undefined, [acceptanceId]),
    ).resolves.toEqual({
      bytes: 900,
      fileCount: 3,
      files: { images: 2, other: 0, videos: 1 },
      rounds: 2,
    });
  });

  it('previews a batch jointly so a hash shared only inside the batch is freed and counted once', async () => {
    await serverDB
      .insert(globalFiles)
      .values({ creator: userId, fileType: 'text/plain', hashId: PAIR_HASH, size: 300, url: 'p' });
    const d = await seedFile({ fileHash: PAIR_HASH, fileType: 'text/plain', size: 300 });
    const e = await seedFile({ fileHash: PAIR_HASH, fileType: 'text/plain', size: 300 });
    const hashless = await seedFile({ fileHash: null, size: 50 });
    const otherAcceptanceId = await seedAcceptance();
    await seedRound(otherAcceptanceId, 1, [d, hashless]);
    await seedRound(acceptanceId, 3, [e]);

    await expect(
      previewAcceptancePurge(serverDB, userId, undefined, [acceptanceId]),
    ).resolves.toMatchObject({ bytes: 900, fileCount: 4, rounds: 3 });

    await expect(
      previewAcceptancePurge(serverDB, userId, undefined, [acceptanceId, otherAcceptanceId]),
    ).resolves.toEqual({
      bytes: 1250,
      fileCount: 6,
      files: { images: 2, other: 3, videos: 1 },
      rounds: 4,
    });
  });

  it('purges files, runs and the acceptance, deleting only unreferenced objects from S3', async () => {
    await expect(
      purgeAcceptance(serverDB, fileService, userId, undefined, acceptanceId),
    ).resolves.toEqual({ deletedFiles: 3, deletedRuns: 2 });

    expect(fileService.deleteFiles).toHaveBeenCalledTimes(1);
    expect(fileService.deleteFiles).toHaveBeenCalledWith(['solo.mp4']);

    await expect(
      serverDB.query.files.findMany({ where: inArray(files.id, fileIds) }),
    ).resolves.toHaveLength(0);
    await expect(
      serverDB.query.files.findFirst({ where: eq(files.id, keeperFileId) }),
    ).resolves.toBeDefined();
    await expect(
      serverDB.query.verifyRuns.findMany({ where: inArray(verifyRuns.id, runIds) }),
    ).resolves.toHaveLength(0);
    await expect(
      serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, acceptanceId) }),
    ).resolves.toBeUndefined();
  });

  it('keeps files still referenced by another run or not owned by the report', async () => {
    const libraryFileId = await seedFile({ fileHash: null, source: null, url: 'library.pdf' });
    const otherAcceptanceId = await seedAcceptance();
    const otherRunId = await seedRound(otherAcceptanceId, 1, [fileIds[2]]);
    await serverDB.insert(verifyEvidence).values({
      checkResultId: (await serverDB.query.verifyCheckResults.findFirst({
        where: eq(verifyCheckResults.verifyRunId, runIds[0]),
      }))!.id,
      fileId: libraryFileId,
      type: 'screenshot',
      userId,
    });

    await expect(
      purgeAcceptance(serverDB, fileService, userId, undefined, acceptanceId),
    ).resolves.toEqual({ deletedFiles: 2, deletedRuns: 2 });

    expect(fileService.deleteFiles).not.toHaveBeenCalled();
    await expect(
      serverDB.query.files.findMany({ where: inArray(files.id, [fileIds[2], libraryFileId]) }),
    ).resolves.toHaveLength(2);
    const otherEvidence = await serverDB
      .select({ fileId: verifyEvidence.fileId })
      .from(verifyEvidence)
      .innerJoin(verifyCheckResults, eq(verifyCheckResults.id, verifyEvidence.checkResultId))
      .where(eq(verifyCheckResults.verifyRunId, otherRunId));
    expect(otherEvidence.map((row) => row.fileId)).toEqual([fileIds[2]]);
  });

  it('deletes rows but leaves storage alone when REMOVE_GLOBAL_FILE is off', async () => {
    envMock.serverDBEnv.REMOVE_GLOBAL_FILE = false;

    await expect(
      purgeAcceptance(serverDB, fileService, userId, undefined, acceptanceId),
    ).resolves.toEqual({ deletedFiles: 3, deletedRuns: 2 });

    expect(fileService.deleteFiles).not.toHaveBeenCalled();
    await expect(
      serverDB.query.files.findMany({ where: inArray(files.id, fileIds) }),
    ).resolves.toHaveLength(0);
    await expect(
      serverDB.query.globalFiles.findFirst({ where: eq(globalFiles.hashId, SOLO_HASH) }),
    ).resolves.toBeDefined();
  });

  it('removes hashless evidence objects from storage by url', async () => {
    const hashless = await seedFile({ fileHash: null, url: 'raw.log' });
    await seedRound(acceptanceId, 3, [hashless]);

    await expect(
      purgeAcceptance(serverDB, fileService, userId, undefined, acceptanceId),
    ).resolves.toEqual({ deletedFiles: 4, deletedRuns: 3 });

    expect(fileService.deleteFiles).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fileService.deleteFiles).mock.calls[0][0].sort()).toEqual([
      'raw.log',
      'solo.mp4',
    ]);
  });

  it('still purges rows and rounds when the storage delete fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fileService.deleteFiles).mockRejectedValueOnce(new Error('s3 down'));

    await expect(
      purgeAcceptance(serverDB, fileService, userId, undefined, acceptanceId),
    ).resolves.toEqual({ deletedFiles: 3, deletedRuns: 2 });

    await expect(
      serverDB.query.verifyRuns.findMany({ where: inArray(verifyRuns.id, runIds) }),
    ).resolves.toHaveLength(0);
    await expect(
      serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, acceptanceId) }),
    ).resolves.toBeUndefined();
  });

  it('removes storage objects before the rounds go away', async () => {
    let runsAtStorageDelete: unknown[] = [];
    vi.mocked(fileService.deleteFiles).mockImplementation(async () => {
      runsAtStorageDelete = await serverDB.query.verifyRuns.findMany({
        where: inArray(verifyRuns.id, runIds),
      });
    });

    await purgeAcceptance(serverDB, fileService, userId, undefined, acceptanceId);

    expect(runsAtStorageDelete).toHaveLength(2);
  });

  it('purges a single round and leaves the acceptance in place', async () => {
    await expect(
      purgeVerifyRun(serverDB, fileService, userId, undefined, runIds[1]),
    ).resolves.toEqual({ deletedFiles: 1 });

    expect(fileService.deleteFiles).toHaveBeenCalledWith(['solo.mp4']);
    await expect(
      serverDB.query.verifyRuns.findMany({ where: inArray(verifyRuns.id, runIds) }),
    ).resolves.toHaveLength(1);
    await expect(
      serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, acceptanceId) }),
    ).resolves.toBeDefined();
  });

  it("does not touch another user's acceptance", async () => {
    const strangerId = await createTestUser(serverDB);
    await expect(
      purgeAcceptance(serverDB, fileService, strangerId, undefined, acceptanceId),
    ).resolves.toEqual({ deletedFiles: 0, deletedRuns: 0 });
    expect(fileService.deleteFiles).not.toHaveBeenCalled();
    await expect(
      serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, acceptanceId) }),
    ).resolves.toBeDefined();
    await cleanupTestUser(serverDB, strangerId);
  });
});
