// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { acceptances, verifyRuns, workspaceMembers, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceRouter } from '../acceptance';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const purgeMocks = vi.hoisted(() => ({
  previewAcceptancePurge: vi.fn(),
  purgeAcceptance: vi.fn(),
}));

vi.mock('@/server/services/verify/acceptancePurge', () => purgeMocks);

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { deleteFiles: vi.fn() };
  }),
}));

describe('acceptanceRouter purge', () => {
  let serverDB: LobeChatDatabase;
  let ownerId: string;
  let strangerId: string;
  let workspaceOwnerId: string;
  let workspaceId: string;
  let personalId: string;
  let workspaceRowId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    vi.clearAllMocks();
    ownerId = await createTestUser(serverDB);
    strangerId = await createTestUser(serverDB);
    workspaceOwnerId = await createTestUser(serverDB);

    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: workspaceOwnerId, slug: `ws-${randomUUID()}` })
      .returning();
    workspaceId = workspace.id;
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId: workspaceOwnerId, workspaceId },
      { role: 'member', userId: ownerId, workspaceId },
    ]);

    const [personal, workspaceRow] = await serverDB
      .insert(acceptances)
      .values([
        {
          subjectId: randomUUID(),
          subjectType: 'standalone',
          userId: ownerId,
          visibility: 'private',
        },
        {
          subjectId: randomUUID(),
          subjectType: 'standalone',
          userId: ownerId,
          visibility: 'private',
          workspaceId,
        },
      ])
      .returning();
    personalId = personal.id;
    workspaceRowId = workspaceRow.id;
  });

  afterEach(async () => {
    await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await cleanupTestUser(serverDB, strangerId);
    await cleanupTestUser(serverDB, workspaceOwnerId);
    await cleanupTestUser(serverDB, ownerId);
  });

  const caller = (userId: string) =>
    acceptanceRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  describe('purgePreview', () => {
    it('previews with the acceptance scope for a reader and hides a private one from strangers', async () => {
      purgeMocks.previewAcceptancePurge.mockResolvedValueOnce({
        bytes: 10,
        fileCount: 1,
        files: { images: 1, other: 0, videos: 0 },
        rounds: 2,
      });

      const res = await caller(ownerId).purgePreview({ ids: [workspaceRowId] });

      expect(res).toEqual({
        bytes: 10,
        fileCount: 1,
        files: { images: 1, other: 0, videos: 0 },
        rounds: 2,
      });
      expect(purgeMocks.previewAcceptancePurge).toHaveBeenCalledWith(
        expect.anything(),
        ownerId,
        workspaceId,
        [workspaceRowId],
      );

      await expect(caller(strangerId).purgePreview({ ids: [personalId] })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('sums one preview per scope across a batch and rejects when any id is unreadable', async () => {
      purgeMocks.previewAcceptancePurge
        .mockResolvedValueOnce({
          bytes: 10,
          fileCount: 1,
          files: { images: 1, other: 0, videos: 0 },
          rounds: 2,
        })
        .mockResolvedValueOnce({
          bytes: 5,
          fileCount: 2,
          files: { images: 0, other: 1, videos: 1 },
          rounds: 1,
        });

      const res = await caller(ownerId).purgePreview({ ids: [personalId, workspaceRowId] });

      expect(res).toEqual({
        bytes: 15,
        fileCount: 3,
        files: { images: 1, other: 1, videos: 1 },
        rounds: 3,
      });
      expect(purgeMocks.previewAcceptancePurge).toHaveBeenCalledTimes(2);
      expect(purgeMocks.previewAcceptancePurge).toHaveBeenCalledWith(
        expect.anything(),
        ownerId,
        undefined,
        [personalId],
      );
      expect(purgeMocks.previewAcceptancePurge).toHaveBeenCalledWith(
        expect.anything(),
        ownerId,
        workspaceId,
        [workspaceRowId],
      );

      await expect(
        caller(strangerId).purgePreview({ ids: [workspaceRowId, personalId] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        caller(ownerId).purgePreview({ ids: [personalId, randomUUID()] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('remove', () => {
    it('detaches the rounds without purging by default', async () => {
      const [run] = await serverDB
        .insert(verifyRuns)
        .values({ acceptanceId: workspaceRowId, roundIndex: 1, userId: ownerId, workspaceId })
        .returning();

      await caller(ownerId).remove({ id: workspaceRowId });

      expect(purgeMocks.purgeAcceptance).not.toHaveBeenCalled();
      expect(
        await serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, workspaceRowId) }),
      ).toBeUndefined();
      expect(
        await serverDB.query.verifyRuns.findFirst({ where: eq(verifyRuns.id, run.id) }),
      ).toMatchObject({ acceptanceId: null });
    });

    it('purges through the acceptance scope when asked', async () => {
      await caller(ownerId).remove({ id: workspaceRowId, purge: true });

      expect(purgeMocks.purgeAcceptance).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        ownerId,
        workspaceId,
        workspaceRowId,
      );
    });

    it('detaches each manageable row in a batch by default and collects the rest', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const [foreign] = await serverDB
        .insert(acceptances)
        .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: strangerId })
        .returning();

      const res = await caller(ownerId).removeBatch({ ids: [personalId, foreign.id] });

      expect(res).toEqual({ deleted: 1, failedIds: [foreign.id] });
      expect(purgeMocks.purgeAcceptance).not.toHaveBeenCalled();
      expect(
        await serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, personalId) }),
      ).toBeUndefined();
    });

    it('purges each manageable row in a batch when asked', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const [foreign] = await serverDB
        .insert(acceptances)
        .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: strangerId })
        .returning();

      const res = await caller(ownerId).removeBatch({ ids: [personalId, foreign.id], purge: true });

      expect(res).toEqual({ deleted: 1, failedIds: [foreign.id] });
      expect(purgeMocks.purgeAcceptance).toHaveBeenCalledTimes(1);
      expect(purgeMocks.purgeAcceptance).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        ownerId,
        undefined,
        personalId,
      );
    });
  });
});
