// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentHistoryJobs, users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AGENT_TRANSFER_PENDING_OWNER_DELETE } from '../agentTransferJob';
import {
  getWorkspaceApiKeyMemberCreation,
  getWorkspaceConnectorMemberManage,
  hasActiveWorkspaceMembership,
  WorkspaceModel,
} from '../workspace';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'workspace-coverage-owner';
const adminId = 'workspace-coverage-admin';
const outsiderId = 'workspace-coverage-outsider';
const userIds = [ownerId, adminId, outsiderId];
const workspaceId = 'workspace-coverage-ws';

const cleanup = async () => {
  // History jobs carry no FK onto users or workspaces, so they are removed by hand.
  await serverDB.delete(agentHistoryJobs).where(inArray(agentHistoryJobs.sourceUserId, userIds));
  // Workspaces and memberships cascade from their owning users.
  await serverDB.delete(users).where(inArray(users.id, userIds));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values(userIds.map((id) => ({ id })));
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: workspaceId,
    primaryOwnerId: ownerId,
    slug: workspaceId,
  });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'admin', userId: adminId, workspaceId },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

describe('workspace helpers coverage', () => {
  it('hasActiveWorkspaceMembership is true for an active member and false for an outsider', async () => {
    expect(await hasActiveWorkspaceMembership(serverDB, { userId: adminId, workspaceId })).toBe(
      true,
    );
    expect(await hasActiveWorkspaceMembership(serverDB, { userId: outsiderId, workspaceId })).toBe(
      false,
    );
  });

  it('getWorkspaceApiKeyMemberCreation falls back to all_members for missing or malformed settings', () => {
    expect(getWorkspaceApiKeyMemberCreation(null)).toBe('all_members');
    expect(getWorkspaceApiKeyMemberCreation('not-an-object')).toBe('all_members');
    expect(getWorkspaceApiKeyMemberCreation({ apiKey: 'not-an-object' })).toBe('all_members');
    expect(getWorkspaceApiKeyMemberCreation({ apiKey: { memberCreation: 'admins_only' } })).toBe(
      'admins_only',
    );
    expect(getWorkspaceApiKeyMemberCreation({ apiKey: { memberCreation: 'unknown' } })).toBe(
      'all_members',
    );
  });

  it('getWorkspaceConnectorMemberManage falls back to all_members for missing or malformed settings', () => {
    expect(getWorkspaceConnectorMemberManage(undefined)).toBe('all_members');
    expect(getWorkspaceConnectorMemberManage(42)).toBe('all_members');
    expect(getWorkspaceConnectorMemberManage({ connector: null })).toBe('all_members');
    expect(getWorkspaceConnectorMemberManage({ connector: { memberManage: 'admins_only' } })).toBe(
      'admins_only',
    );
    expect(getWorkspaceConnectorMemberManage({ connector: { memberManage: 'unknown' } })).toBe(
      'all_members',
    );
  });
});

describe('WorkspaceModel coverage', () => {
  it('reads admins_only back through the stored settings', async () => {
    const model = new WorkspaceModel(serverDB, ownerId);

    await model.updateApiKeyMemberCreation(workspaceId, 'admins_only');
    await model.updateConnectorMemberManage(workspaceId, 'admins_only');

    expect(await model.getApiKeyMemberCreation(workspaceId)).toBe('admins_only');
    expect(await model.getConnectorMemberManage(workspaceId)).toBe('admins_only');
  });

  it('refuses to delete a workspace while a pending transfer job still points at it', async () => {
    await serverDB.insert(agentHistoryJobs).values({
      agentIds: [],
      sessionIds: [],
      sourceUserId: ownerId,
      sourceWorkspaceId: workspaceId,
      status: 'pending',
      targetUserId: ownerId,
      totalTopics: 1,
      type: 'transfer',
    });

    await expect(new WorkspaceModel(serverDB, ownerId).delete(workspaceId)).rejects.toThrow(
      AGENT_TRANSFER_PENDING_OWNER_DELETE,
    );

    const [row] = await serverDB.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(row).toBeDefined();
  });

  it('aborts the ownership transfer when the owner changed between the read and the swap', async () => {
    const model = new WorkspaceModel(serverDB, ownerId);
    const transaction = serverDB.transaction.bind(serverDB);

    // Stand in for a concurrent transfer that commits after this one read the
    // workspace: the read still sees the old owner, the compare-and-swap does not.
    vi.spyOn(serverDB, 'transaction').mockImplementation(((callback: any) =>
      transaction(async (tx) => {
        const findFirst = tx.query.workspaces.findFirst.bind(tx.query.workspaces);
        vi.spyOn(tx.query.workspaces, 'findFirst').mockImplementation(((config: any) =>
          findFirst(config).then(async (row) => {
            await tx
              .update(workspaces)
              .set({ primaryOwnerId: adminId })
              .where(eq(workspaces.id, workspaceId));
            return row;
          })) as any);
        return callback(tx);
      })) as any);

    await expect(model.transferPrimaryOwnership(workspaceId, adminId)).rejects.toThrow(
      'Only the workspace owner can transfer ownership',
    );
    vi.restoreAllMocks();

    // The whole transaction rolled back: owner and both roles are unchanged.
    const [row] = await serverDB.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(row.primaryOwnerId).toBe(ownerId);
    const members = await serverDB
      .select({ role: workspaceMembers.role, userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    expect(members).toEqual(
      expect.arrayContaining([
        { role: 'owner', userId: ownerId },
        { role: 'admin', userId: adminId },
      ]),
    );
  });

  it('downgradeToFree treats null settings as empty', async () => {
    await serverDB.update(workspaces).set({ settings: null }).where(eq(workspaces.id, workspaceId));

    const { workspace } = await new WorkspaceModel(serverDB, ownerId).downgradeToFree(workspaceId);

    expect(workspace.settings).toEqual({});
  });

  it('setGracePeriod treats null settings as empty', async () => {
    await serverDB.update(workspaces).set({ settings: null }).where(eq(workspaces.id, workspaceId));

    await new WorkspaceModel(serverDB, ownerId).setGracePeriod(workspaceId, 1234);

    const [row] = await serverDB.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(row.settings).toEqual({ gracePeriodUntil: 1234 });
  });
});
