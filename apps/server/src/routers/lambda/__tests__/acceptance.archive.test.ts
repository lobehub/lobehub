// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { acceptances, workspaceMembers, workspaces } from '@lobechat/database/schemas';
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

describe('acceptanceRouter archive', () => {
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

  const archivedAtOf = async (id: string) =>
    (await serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, id) }))?.archivedAt;

  describe('archive / unarchive', () => {
    it('stamps archivedAt for the owner and clears it again', async () => {
      const archived = await caller(ownerId).archive({ id: personalId });
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(await archivedAtOf(personalId)).toBeInstanceOf(Date);

      const unarchived = await caller(ownerId).unarchive({ id: personalId });
      expect(unarchived.archivedAt).toBeNull();
      expect(await archivedAtOf(personalId)).toBeNull();
    });

    it('lets the workspace owner archive a member row', async () => {
      await caller(workspaceOwnerId).archive({ id: workspaceRowId });
      expect(await archivedAtOf(workspaceRowId)).toBeInstanceOf(Date);
    });

    it('answers NOT_FOUND to a stranger without touching the row', async () => {
      await expect(caller(strangerId).archive({ id: personalId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(caller(strangerId).unarchive({ id: personalId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await archivedAtOf(personalId)).toBeNull();
    });
  });

  describe('archiveBatch', () => {
    it('collects rows the caller may not archive instead of failing the sweep', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const [foreign] = await serverDB
        .insert(acceptances)
        .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: strangerId })
        .returning();

      const res = await caller(ownerId).archiveBatch({
        ids: [personalId, foreign.id, 'not-a-uuid'],
      });

      expect(res).toEqual({ archived: 1, failedIds: [foreign.id, 'not-a-uuid'] });
      expect(await archivedAtOf(personalId)).toBeInstanceOf(Date);
      expect(await archivedAtOf(foreign.id)).toBeNull();
    });
  });

  describe('list filters', () => {
    it('hides archived rows by default and lists them under the archived filter', async () => {
      const [live] = await serverDB
        .insert(acceptances)
        .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: ownerId })
        .returning();
      await caller(ownerId).archive({ id: personalId });

      const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
      expect(ids(await caller(ownerId).list())).toEqual([live.id]);
      expect(ids(await caller(ownerId).list({ filter: 'all' }))).toEqual([live.id]);
      expect(ids(await caller(ownerId).list({ filter: 'archived' }))).toEqual([personalId]);

      const page = await caller(ownerId).listPage({ filter: 'archived' });
      expect(ids(page.items)).toEqual([personalId]);
      expect(ids((await caller(ownerId).listPage({ filter: 'active' })).items)).toEqual([live.id]);
    });
  });
});
