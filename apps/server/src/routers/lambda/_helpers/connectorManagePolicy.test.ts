// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertConnectorCredentialsManageable,
  assertConnectorMaintainable,
  canManageWorkspaceConnectors,
} from './connectorManagePolicy';

const workspaceMocks = vi.hoisted(() => ({
  getConnectorMemberManage: vi.fn(
    async (): Promise<'admins_only' | 'all_members'> => 'all_members',
  ),
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return workspaceMocks;
  }),
}));

const ctxFor = (workspaceRole?: string, workspaceId: string | null = 'ws-1') => ({
  serverDB: {} as any,
  userId: 'me',
  workspaceId,
  workspaceRole,
});

describe('connectorManagePolicy', () => {
  beforeEach(() => {
    workspaceMocks.getConnectorMemberManage.mockResolvedValue('all_members');
  });

  describe('canManageWorkspaceConnectors', () => {
    it('always allows personal mode, owners and admins', async () => {
      workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');

      await expect(canManageWorkspaceConnectors(ctxFor(undefined, null))).resolves.toBe(true);
      await expect(canManageWorkspaceConnectors(ctxFor('owner'))).resolves.toBe(true);
      await expect(canManageWorkspaceConnectors(ctxFor('admin'))).resolves.toBe(true);
    });

    it('never allows viewers', async () => {
      await expect(canManageWorkspaceConnectors(ctxFor('viewer'))).resolves.toBe(false);
    });

    it('follows the member policy for members, allowing them by default', async () => {
      await expect(canManageWorkspaceConnectors(ctxFor('member'))).resolves.toBe(true);

      workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');
      await expect(canManageWorkspaceConnectors(ctxFor('member'))).resolves.toBe(false);
    });
  });

  describe('assertConnectorMaintainable', () => {
    it('lets a member maintain a shared row someone else created by default', async () => {
      await expect(
        assertConnectorMaintainable(ctxFor('member'), { userId: 'someone-else' }),
      ).resolves.toBeUndefined();
    });

    it('rejects a member, even the creator, once admins restricted it', async () => {
      workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');

      await expect(
        assertConnectorMaintainable(ctxFor('member'), { userId: 'me' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(assertConnectorMaintainable(ctxFor('member'))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('keeps the creator rule for agent-scoped rows', async () => {
      await expect(
        assertConnectorMaintainable(ctxFor('member'), { agentId: 'a1', userId: 'someone-else' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        assertConnectorMaintainable(ctxFor('member'), { agentId: 'a1', userId: 'me' }),
      ).resolves.toBeUndefined();
      // A new agent row has no creator yet; agent edit rights gate it upstream.
      await expect(
        assertConnectorMaintainable(ctxFor('member'), { agentId: 'a1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertConnectorCredentialsManageable', () => {
    it("keeps another member's stored credentials creator/owner only", async () => {
      await expect(
        assertConnectorCredentialsManageable(ctxFor('member'), { userId: 'someone-else' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        assertConnectorCredentialsManageable(ctxFor('member'), { userId: 'me' }),
      ).resolves.toBeUndefined();
      await expect(
        assertConnectorCredentialsManageable(ctxFor('owner'), { userId: 'someone-else' }),
      ).resolves.toBeUndefined();
    });

    it('also applies the member policy to the creator', async () => {
      workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');

      await expect(
        assertConnectorCredentialsManageable(ctxFor('member'), { userId: 'me' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
