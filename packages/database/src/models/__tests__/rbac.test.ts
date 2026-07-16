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

  describe('seedWorkspaceRoles', () => {
    it('removes stale permissions from a built-in role when re-seeded', async () => {
      const [memberRole] = await serverDB
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(eq(roles.name, WORKSPACE_SYSTEM_ROLES.MEMBER), eq(roles.workspaceId, workspaceAId)),
        )
        .limit(1);
      const apiKeyReadCode = `${PERMISSION_ACTIONS.API_KEY_READ}:all`;
      const [apiKeyReadPermission] = await serverDB
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.code, apiKeyReadCode))
        .limit(1);

      await serverDB.insert(rolePermissions).values({
        permissionId: apiKeyReadPermission.id,
        roleId: memberRole.id,
      });

      await seedWorkspaceRoles(serverDB, workspaceAId);

      const staleLinks = await serverDB
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, memberRole.id),
            eq(rolePermissions.permissionId, apiKeyReadPermission.id),
          ),
        );
      expect(staleLinks).toEqual([]);
    });
  });

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

    it('accepts a bare userId string and resolves grants for that user', async () => {
      // legacy call form: hasPermission(code, userId) — normalizeScope's string branch.
      const rbac = new RbacModel(serverDB, otherUserId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      // model bound to otherUserId, but the string arg overrides the target.
      expect(await rbac.hasPermission(ownerCode, userId)).toBe(true);
      // otherUserId itself has no grant.
      expect(await rbac.hasPermission(ownerCode)).toBe(false);
    });

    it('falls back to the constructor userId when no scope arg is given', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      // no arg at all → targets this.userId.
      expect(await rbac.getUserPermissions()).toContain(ownerCode);
    });
  });

  describe('getUserPermissionDetails', () => {
    it('returns ordered detail rows with role/category/name metadata', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      const details = await rbac.getUserPermissionDetails({ workspaceId: workspaceAId });

      expect(details.length).toBeGreaterThan(0);
      // every row carries the full shape
      for (const row of details) {
        expect(row.permissionCode).toBeTruthy();
        expect(row.permissionName).toBeTruthy();
        expect(row.category).toBeTruthy();
        expect(row.roleName).toBe(WORKSPACE_SYSTEM_ROLES.OWNER);
      }
      // the owner-update code is present
      expect(details.some((r) => r.permissionCode === ownerCode)).toBe(true);
      // ordered by (category, code) ascending
      const sorted = [...details].sort((a, b) =>
        a.category === b.category
          ? a.permissionCode.localeCompare(b.permissionCode)
          : a.category.localeCompare(b.category),
      );
      expect(details.map((r) => r.permissionCode)).toEqual(sorted.map((r) => r.permissionCode));
    });

    it('returns an empty array for a user with no grants', async () => {
      const rbac = new RbacModel(serverDB, otherUserId);
      expect(await rbac.getUserPermissionDetails({ workspaceId: workspaceAId })).toEqual([]);
    });
  });

  describe('hasAnyPermission', () => {
    it('returns false immediately for an empty permission list (no DB hit)', async () => {
      const rbac = new RbacModel(serverDB, userId);
      expect(await rbac.hasAnyPermission([])).toBe(false);
    });

    it('returns true when at least one code is granted', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.VIEWER,
        userId,
        workspaceId: workspaceAId,
      });

      // viewer lacks ownerCode but has memberCode → OR is satisfied.
      expect(
        await rbac.hasAnyPermission([ownerCode, memberCode], { workspaceId: workspaceAId }),
      ).toBe(true);
    });

    it('returns false when none of the codes are granted', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.VIEWER,
        userId,
        workspaceId: workspaceAId,
      });

      expect(
        await rbac.hasAnyPermission(['nonexistent:perm:all'], { workspaceId: workspaceAId }),
      ).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true immediately for an empty permission list', async () => {
      const rbac = new RbacModel(serverDB, userId);
      expect(await rbac.hasAllPermissions([])).toBe(true);
    });

    it('returns true when every code is granted', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      // owner has both codes.
      expect(
        await rbac.hasAllPermissions([ownerCode, memberCode], { workspaceId: workspaceAId }),
      ).toBe(true);
    });

    it('returns false when at least one code is missing', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.VIEWER,
        userId,
        workspaceId: workspaceAId,
      });

      // viewer has memberCode but not ownerCode → AND fails.
      expect(
        await rbac.hasAllPermissions([ownerCode, memberCode], { workspaceId: workspaceAId }),
      ).toBe(false);
    });
  });

  describe('getUserRoles', () => {
    it('returns the active roles granted to the user in a workspace', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceAId,
      });

      const userRoleList = await rbac.getUserRoles({ workspaceId: workspaceAId });
      expect(userRoleList).toHaveLength(1);
      expect(userRoleList[0].name).toBe(WORKSPACE_SYSTEM_ROLES.OWNER);
      expect(userRoleList[0].workspaceId).toBe(workspaceAId);
      expect(userRoleList[0].isActive).toBe(true);
    });

    it('returns an empty array when the user has no grants', async () => {
      const rbac = new RbacModel(serverDB, otherUserId);
      expect(await rbac.getUserRoles({ workspaceId: workspaceAId })).toEqual([]);
    });

    it('does not return roles granted in a different workspace', async () => {
      const rbac = new RbacModel(serverDB, userId);
      await rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId,
        workspaceId: workspaceBId,
      });

      expect(await rbac.getUserRoles({ workspaceId: workspaceAId })).toEqual([]);
      expect(await rbac.getUserRoles({ workspaceId: workspaceBId })).toHaveLength(1);
    });
  });

  describe('updateUserRoles', () => {
    const roleIdFor = async (name: string, workspaceId: string): Promise<string> => {
      const row = await serverDB.query.roles.findFirst({
        where: and(eq(roles.name, name), eq(roles.workspaceId, workspaceId)),
      });
      if (!row) throw new Error(`role ${name} not seeded`);
      return row.id;
    };

    it('throws when one of the role ids does not exist', async () => {
      const rbac = new RbacModel(serverDB, userId);
      const validId = await roleIdFor(WORKSPACE_SYSTEM_ROLES.OWNER, workspaceAId);

      await expect(rbac.updateUserRoles(userId, [validId, 'missing-role-id'])).rejects.toThrow(
        /missing-role-id do not exist/,
      );
    });

    it('replaces the user existing roles with the provided set', async () => {
      const rbac = new RbacModel(serverDB, userId);
      const ownerId = await roleIdFor(WORKSPACE_SYSTEM_ROLES.OWNER, workspaceAId);
      const memberId = await roleIdFor(WORKSPACE_SYSTEM_ROLES.MEMBER, workspaceAId);

      // pre-seed an existing grant that should be wiped by the replace.
      await serverDB.insert(userRoles).values({ roleId: ownerId, userId });

      await rbac.updateUserRoles(userId, [memberId]);

      const grants = await serverDB.query.userRoles.findMany({
        where: eq(userRoles.userId, userId),
      });
      expect(grants).toHaveLength(1);
      expect(grants[0].roleId).toBe(memberId);
    });

    it('removes all roles when given an empty array', async () => {
      const rbac = new RbacModel(serverDB, userId);
      const ownerId = await roleIdFor(WORKSPACE_SYSTEM_ROLES.OWNER, workspaceAId);
      await serverDB.insert(userRoles).values({ roleId: ownerId, userId });

      await rbac.updateUserRoles(userId, []);

      const grants = await serverDB.query.userRoles.findMany({
        where: eq(userRoles.userId, userId),
      });
      expect(grants).toHaveLength(0);
    });

    it('only touches the target user roles, leaving others intact', async () => {
      const rbac = new RbacModel(serverDB, userId);
      const ownerId = await roleIdFor(WORKSPACE_SYSTEM_ROLES.OWNER, workspaceAId);
      const memberId = await roleIdFor(WORKSPACE_SYSTEM_ROLES.MEMBER, workspaceAId);

      await serverDB.insert(userRoles).values({ roleId: ownerId, userId: otherUserId });

      await rbac.updateUserRoles(userId, [memberId]);

      const otherGrants = await serverDB.query.userRoles.findMany({
        where: eq(userRoles.userId, otherUserId),
      });
      expect(otherGrants).toHaveLength(1);
      expect(otherGrants[0].roleId).toBe(ownerId);
    });
  });
});
