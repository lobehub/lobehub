// @vitest-environment node
import {
  PERMISSION_ACTIONS,
  WORKSPACE_ROLE_PERMISSIONS,
  WORKSPACE_SYSTEM_ROLES,
} from '@lobechat/const/rbac';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { permissions, rolePermissions, roles, userRoles, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { seedWorkspaceRoles } from '../../utils/seedWorkspaceRoles';
import { RbacModel } from '../rbac';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'rbac-model-test-user-id';
const otherUserId = 'rbac-model-test-other-user-id';
const workspaceAId = 'rbac-ws-a';
const workspaceBId = 'rbac-ws-b';

const cleanup = async () => {
  // userRoles + rolePermissions cascade via FK, but workspace-scoped roles only
  // cascade when the workspace itself is deleted — so do it explicitly here.
  await serverDB.delete(userRoles);
  await serverDB.delete(rolePermissions);
  await serverDB.delete(roles);
  await serverDB.delete(permissions);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceAId, name: 'A', primaryOwnerId: userId, slug: 'ws-a' },
    { id: workspaceBId, name: 'B', primaryOwnerId: userId, slug: 'ws-b' },
  ]);
  await seedWorkspaceRoles(serverDB, workspaceAId);
  await seedWorkspaceRoles(serverDB, workspaceBId);
});

afterEach(async () => {
  await cleanup();
});

describe('RbacModel — workspace scope', () => {
  const ownerCode = `${PERMISSION_ACTIONS.WORKSPACE_UPDATE}:all`;
  const memberCode = `${PERMISSION_ACTIONS.WORKSPACE_READ}:all`;

  describe('assignWorkspaceRole / hasPermission with workspaceId', () => {
    it('returns true for a permission granted via the assigned role in that workspace', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      expect(await rbac.hasPermission(ownerCode, { workspaceId: workspaceAId })).toBe(true);
    });

    it('returns false for a permission the assigned role does not include', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.VIEWER,
        userId,
        workspaceId: workspaceAId,
      });

      // viewer never gets workspace:update:all (only owner does).
      expect(await rbac.hasPermission(ownerCode, { workspaceId: workspaceAId })).toBe(false);
      // but viewer does have workspace:read:all.
      expect(await rbac.hasPermission(memberCode, { workspaceId: workspaceAId })).toBe(true);
    });

    it('does not leak permissions across workspaces', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      expect(await rbac.hasPermission(ownerCode, { workspaceId: workspaceAId })).toBe(true);
      expect(await rbac.hasPermission(ownerCode, { workspaceId: workspaceBId })).toBe(false);
    });

    it('is idempotent', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });
      // Re-assigning is a no-op thanks to the (userId, roleId, workspaceId)
      // unique index — must not throw.
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      const grants = await serverDB.query.userRoles.findMany({
        where: and(eq(userRoles.userId, userId), eq(userRoles.workspaceId, workspaceAId)),
      });
      expect(grants).toHaveLength(1);
    });
  });

  describe('revokeWorkspaceRole', () => {
    it('drops every grant in the named workspace and leaves others untouched', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceBId,
      });

      await rbac.revokeWorkspaceRole({ userId, workspaceId: workspaceAId });

      expect(await rbac.hasPermission(ownerCode, { workspaceId: workspaceAId })).toBe(false);
      expect(await rbac.hasPermission(ownerCode, { workspaceId: workspaceBId })).toBe(true);
    });

    it('is a no-op when the user has no grants in the workspace', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await expect(
        rbac.revokeWorkspaceRole({ userId, workspaceId: workspaceAId }),
      ).resolves.not.toThrow();
    });
  });

  describe('getUserPermissions with workspaceId', () => {
    it('returns scoped codes for the named workspace, de-duped', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      const codes = await rbac.getUserPermissions({ workspaceId: workspaceAId });

      const expected = new Set(WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.OWNER]);
      // every code the owner role grants should appear in the result
      for (const code of expected) {
        expect(codes).toContain(code);
      }
      // ...and no duplicates
      expect(codes).toHaveLength(new Set(codes).size);
    });

    it('does not include workspace B permissions when scoped to workspace A', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceBId,
      });
      // user has no grant in workspaceA
      const codes = await rbac.getUserPermissions({ workspaceId: workspaceAId });
      expect(codes).toEqual([]);
    });
  });

  describe('listWorkspaceRoles', () => {
    it('lists the three built-in roles seeded for that workspace', async () => {
      const rbac = new RbacModel(serverDB, userId);
      const list = await rbac.listWorkspaceRoles(workspaceAId);
      const names = list.map((r) => r.name).sort();
      expect(names).toEqual(
        [
          WORKSPACE_SYSTEM_ROLES.MEMBER,
          WORKSPACE_SYSTEM_ROLES.OWNER,
          WORKSPACE_SYSTEM_ROLES.VIEWER,
        ].sort(),
      );
      expect(list.every((r) => r.workspaceId === workspaceAId)).toBe(true);
    });
  });

  describe('back-compat: no workspaceId', () => {
    it('still matches workspace-scoped grants when no workspaceId is given (legacy behavior)', async () => {
      // Hono routes call `hasPermission(code)` without workspaceId. This must
      // keep returning true for users whose only grant is workspace-scoped,
      // otherwise every Hono content route regresses on workspace users.
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      expect(await rbac.hasPermission(ownerCode)).toBe(true);
    });
  });
});
