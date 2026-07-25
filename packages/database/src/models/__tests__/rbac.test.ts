// @vitest-environment node
import {
  getWorkspaceRolePermissionCodes,
  PERMISSION_ACTIONS,
  WORKSPACE_ROLE_PERMISSIONS,
  WORKSPACE_SYSTEM_ROLES,
} from '@lobechat/const/rbac';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
  workspaceMembers,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { RbacModel } from '../rbac';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'rbac-model-test-user-id';
const otherUserId = 'rbac-model-test-other-user-id';
const workspaceAId = 'rbac-ws-a';
const workspaceBId = 'rbac-ws-b';

const cleanup = async () => {
  await serverDB.delete(userRoles);
  await serverDB.delete(rolePermissions);
  await serverDB.delete(roles);
  await serverDB.delete(permissions);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

const addMembership = async (
  memberUserId: string,
  workspaceId: string,
  role: string,
  deletedAt?: Date,
) => {
  await serverDB.insert(workspaceMembers).values({
    deletedAt: deletedAt ?? null,
    role,
    userId: memberUserId,
    workspaceId,
  });
};

/**
 * Provision a globally-scoped DB role (like `super_admin`) granting the given
 * permission codes, and grant it to the user.
 */
const grantGlobalRole = async (
  grantUserId: string,
  roleName: string,
  permissionCodes: string[],
) => {
  const [role] = await serverDB
    .insert(roles)
    .values({ displayName: roleName, isActive: true, isSystem: true, name: roleName })
    .returning({ id: roles.id });

  for (const code of permissionCodes) {
    const [permission] = await serverDB
      .insert(permissions)
      .values({ category: 'test', code, isActive: true, name: code })
      .onConflictDoNothing()
      .returning({ id: permissions.id });
    const permissionId =
      permission?.id ??
      (await serverDB.query.permissions.findFirst({ where: eq(permissions.code, code) }))!.id;
    await serverDB.insert(rolePermissions).values({ permissionId, roleId: role.id });
  }

  await serverDB.insert(userRoles).values({ roleId: role.id, userId: grantUserId });
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceAId, name: 'A', primaryOwnerId: otherUserId, slug: 'ws-a' },
    { id: workspaceBId, name: 'B', primaryOwnerId: otherUserId, slug: 'ws-b' },
  ]);
});

afterEach(cleanup);

describe('RbacModel — workspace mode (membership.role is the source of truth)', () => {
  const readCode = `${PERMISSION_ACTIONS.WORKSPACE_READ}:all`;
  const updateCode = `${PERMISSION_ACTIONS.WORKSPACE_UPDATE}:all`;
  const deleteCode = `${PERMISSION_ACTIONS.WORKSPACE_DELETE}:all`;
  const billingManageCode = `${PERMISSION_ACTIONS.WORKSPACE_BILLING_MANAGE}:all`;

  describe('hasPermission', () => {
    it('owner passes owner-only and shared codes', async () => {
      // Owner semantics require the primary-owner binding.
      await serverDB
        .update(workspaces)
        .set({ primaryOwnerId: userId })
        .where(eq(workspaces.id, workspaceAId));
      await addMembership(userId, workspaceAId, 'owner');
      const rbac = new RbacModel(serverDB, userId);

      expect(await rbac.hasPermission(deleteCode, { workspaceId: workspaceAId })).toBe(true);
      expect(await rbac.hasPermission(billingManageCode, { workspaceId: workspaceAId })).toBe(true);
      expect(await rbac.hasPermission(updateCode, { workspaceId: workspaceAId })).toBe(true);
    });

    it('admin gets shared management but not owner-only capabilities', async () => {
      await addMembership(userId, workspaceAId, 'admin');
      const rbac = new RbacModel(serverDB, userId);

      expect(await rbac.hasPermission(updateCode, { workspaceId: workspaceAId })).toBe(true);
      expect(await rbac.hasPermission(deleteCode, { workspaceId: workspaceAId })).toBe(false);
      expect(await rbac.hasPermission(billingManageCode, { workspaceId: workspaceAId })).toBe(
        false,
      );
    });

    it('member can write own content but not workspace settings', async () => {
      await addMembership(userId, workspaceAId, 'member');
      const rbac = new RbacModel(serverDB, userId);

      expect(await rbac.hasPermission(readCode, { workspaceId: workspaceAId })).toBe(true);
      expect(
        await rbac.hasPermission(`${PERMISSION_ACTIONS.AGENT_UPDATE}:owner`, {
          workspaceId: workspaceAId,
        }),
      ).toBe(true);
      expect(await rbac.hasPermission(updateCode, { workspaceId: workspaceAId })).toBe(false);
    });

    it('viewer is read-only', async () => {
      await addMembership(userId, workspaceAId, 'viewer');
      const rbac = new RbacModel(serverDB, userId);

      expect(await rbac.hasPermission(readCode, { workspaceId: workspaceAId })).toBe(true);
      expect(
        await rbac.hasPermission(`${PERMISSION_ACTIONS.AGENT_CREATE}:owner`, {
          workspaceId: workspaceAId,
        }),
      ).toBe(false);
    });

    it('non-members and soft-deleted members have no workspace permissions', async () => {
      const rbac = new RbacModel(serverDB, userId);
      expect(await rbac.hasPermission(readCode, { workspaceId: workspaceAId })).toBe(false);

      await addMembership(userId, workspaceBId, 'owner', new Date());
      expect(await rbac.hasPermission(readCode, { workspaceId: workspaceBId })).toBe(false);
    });

    it('does not leak permissions across workspaces', async () => {
      await addMembership(userId, workspaceAId, 'owner');
      const rbac = new RbacModel(serverDB, userId);

      expect(await rbac.hasPermission(deleteCode, { workspaceId: workspaceBId })).toBe(false);
    });

    it('ignores stale workspace-scoped DB grants — the column wins', async () => {
      // Legacy seeded state claims Owner via rbac_user_roles, but the
      // membership column says viewer. The column is authoritative.
      await addMembership(userId, workspaceAId, 'viewer');
      const [staleRole] = await serverDB
        .insert(roles)
        .values({
          displayName: 'Owner',
          isActive: true,
          isSystem: true,
          name: WORKSPACE_SYSTEM_ROLES.OWNER,
          workspaceId: workspaceAId,
        })
        .returning({ id: roles.id });
      const [permission] = await serverDB
        .insert(permissions)
        .values({ category: 'test', code: deleteCode, isActive: true, name: deleteCode })
        .returning({ id: permissions.id });
      await serverDB
        .insert(rolePermissions)
        .values({ permissionId: permission.id, roleId: staleRole.id });
      await serverDB
        .insert(userRoles)
        .values({ roleId: staleRole.id, userId, workspaceId: workspaceAId });

      const rbac = new RbacModel(serverDB, userId);
      expect(await rbac.hasPermission(deleteCode, { workspaceId: workspaceAId })).toBe(false);
    });

    it('expands a legacy non-primary owner label as admin until data converges', async () => {
      // workspaceA's primary owner is otherUserId — userId's stray owner
      // label must not unlock Owner-only permissions.
      await addMembership(userId, workspaceAId, 'owner');
      const rbac = new RbacModel(serverDB, userId);

      expect(await rbac.hasPermission(updateCode, { workspaceId: workspaceAId })).toBe(true);
      expect(await rbac.hasPermission(deleteCode, { workspaceId: workspaceAId })).toBe(false);
      expect(await rbac.hasPermission(billingManageCode, { workspaceId: workspaceAId })).toBe(
        false,
      );
    });

    it('globally-granted roles (super_admin) still pass inside any workspace', async () => {
      await grantGlobalRole(userId, 'super_admin', [deleteCode]);
      const rbac = new RbacModel(serverDB, userId);

      // Not even a member of workspace A.
      expect(await rbac.hasPermission(deleteCode, { workspaceId: workspaceAId })).toBe(true);
    });
  });

  describe('getUserPermissions', () => {
    it('returns exactly the in-code matrix expansion for each built-in role', async () => {
      await addMembership(userId, workspaceAId, 'admin');
      const rbac = new RbacModel(serverDB, userId);

      const codes = await rbac.getUserPermissions({ workspaceId: workspaceAId });
      expect(new Set(codes)).toEqual(
        new Set(WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.ADMIN]),
      );
      expect(new Set(codes)).toEqual(new Set(getWorkspaceRolePermissionCodes('admin')));
    });

    it('unions matrix codes with globally-granted codes, de-duped', async () => {
      await addMembership(userId, workspaceAId, 'viewer');
      const globalOnlyCode = 'test:global:all';
      await grantGlobalRole(userId, 'super_admin', [globalOnlyCode, readCode]);
      const rbac = new RbacModel(serverDB, userId);

      const codes = await rbac.getUserPermissions({ workspaceId: workspaceAId });
      expect(codes).toContain(globalOnlyCode);
      expect(codes.filter((code) => code === readCode)).toHaveLength(1);
    });

    it('returns only global codes for non-members', async () => {
      const globalOnlyCode = 'test:global:all';
      await grantGlobalRole(userId, 'super_admin', [globalOnlyCode]);
      const rbac = new RbacModel(serverDB, userId);

      expect(await rbac.getUserPermissions({ workspaceId: workspaceAId })).toEqual([
        globalOnlyCode,
      ]);
    });

    it('resolves multiple active members and their global grants in one batch', async () => {
      const globalOnlyCode = 'test:global:all';
      await Promise.all([
        addMembership(userId, workspaceAId, 'member'),
        addMembership(otherUserId, workspaceAId, 'owner'),
      ]);
      await grantGlobalRole(userId, 'super_admin', [globalOnlyCode]);

      const permissionsByUserId = await RbacModel.getWorkspaceUsersPermissions({
        db: serverDB,
        requireMembership: true,
        userIds: [userId, otherUserId, 'not-a-member'],
        workspaceId: workspaceAId,
      });

      expect(permissionsByUserId.has('not-a-member')).toBe(false);
      expect(permissionsByUserId.get(userId)).toEqual(
        expect.arrayContaining([`${PERMISSION_ACTIONS.AGENT_READ}:all`, globalOnlyCode]),
      );
      expect(permissionsByUserId.get(otherUserId)).toEqual(
        expect.arrayContaining([billingManageCode]),
      );
    });
  });

  describe('hasAnyPermission / hasAllPermissions', () => {
    it('returns false immediately for an empty permission list (no DB hit)', async () => {
      const rbac = new RbacModel(serverDB, userId);
      expect(await rbac.hasAnyPermission([], { workspaceId: workspaceAId })).toBe(false);
      expect(await rbac.hasAllPermissions([], { workspaceId: workspaceAId })).toBe(true);
    });

    it('OR semantics across matrix codes', async () => {
      await addMembership(userId, workspaceAId, 'member');
      const rbac = new RbacModel(serverDB, userId);

      expect(
        await rbac.hasAnyPermission([deleteCode, readCode], { workspaceId: workspaceAId }),
      ).toBe(true);
      expect(
        await rbac.hasAnyPermission([deleteCode, billingManageCode], {
          workspaceId: workspaceAId,
        }),
      ).toBe(false);
    });

    it('AND semantics across matrix codes', async () => {
      await serverDB
        .update(workspaces)
        .set({ primaryOwnerId: userId })
        .where(eq(workspaces.id, workspaceAId));
      await addMembership(userId, workspaceAId, 'owner');
      const rbac = new RbacModel(serverDB, userId);

      expect(
        await rbac.hasAllPermissions([deleteCode, readCode], { workspaceId: workspaceAId }),
      ).toBe(true);

      await addMembership(otherUserId, workspaceAId, 'member');
      const memberRbac = new RbacModel(serverDB, otherUserId);
      expect(
        await memberRbac.hasAllPermissions([deleteCode, readCode], { workspaceId: workspaceAId }),
      ).toBe(false);
    });
  });

  describe('getUserRoles with workspaceId', () => {
    it('returns only globally-granted DB roles — built-in workspace roles live on the column', async () => {
      await addMembership(userId, workspaceAId, 'owner');
      await grantGlobalRole(userId, 'super_admin', ['test:global:all']);
      const rbac = new RbacModel(serverDB, userId);

      const rolesInWorkspace = await rbac.getUserRoles({ workspaceId: workspaceAId });
      expect(rolesInWorkspace.map(({ name }) => name)).toEqual(['super_admin']);
    });
  });
});

describe('WORKSPACE_ROLE_PERMISSIONS matrix — topic comments', () => {
  it('assigns the topic comment permission matrix to built-in roles', () => {
    expect(WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.OWNER]).toEqual(
      expect.arrayContaining([
        'topic_comment:read:all',
        'topic_comment:create:all',
        'topic_comment:update:all',
        'topic_comment:delete:all',
        'topic_comment:restore:all',
      ]),
    );
    expect(WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.MEMBER]).toEqual(
      expect.arrayContaining([
        'topic_comment:read:all',
        'topic_comment:create:owner',
        'topic_comment:update:owner',
        'topic_comment:delete:owner',
      ]),
    );
    expect(WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.VIEWER]).toContain(
      'topic_comment:read:all',
    );
    expect(WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.MEMBER]).not.toContain(
      'topic_comment:restore:all',
    );
    expect(WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.VIEWER]).not.toContain(
      'topic_comment:restore:all',
    );
  });
});

describe('RbacModel — back-compat: no workspaceId', () => {
  it('matches any DB grant regardless of workspace scope (legacy behavior)', async () => {
    const code = 'test:legacy:all';
    await grantGlobalRole(userId, 'legacy_role', [code]);
    const rbac = new RbacModel(serverDB, userId);

    expect(await rbac.hasPermission(code)).toBe(true);
    expect(await rbac.getUserPermissions()).toContain(code);
  });

  it('accepts a bare userId string and resolves grants for that user', async () => {
    const code = 'test:legacy:all';
    await grantGlobalRole(otherUserId, 'legacy_role', [code]);
    const rbac = new RbacModel(serverDB, userId);

    expect(await rbac.hasPermission(code, otherUserId)).toBe(true);
    expect(await rbac.hasPermission(code)).toBe(false);
  });

  it('getUserPermissionDetails returns metadata rows for granted roles', async () => {
    const code = 'test:detail:all';
    await grantGlobalRole(userId, 'detail_role', [code]);
    const rbac = new RbacModel(serverDB, userId);

    const details = await rbac.getUserPermissionDetails();
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ permissionCode: code, roleName: 'detail_role' });
  });
});
