import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RBAC_PERMISSIONS } from '@/const/rbac';

import { getTestDB } from '../../core/getTestDB';
import { initializeRBAC } from '../../initializeRBAC';
import { permissions, rolePermissions, roles, userRoles, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerPermissionCount = Object.values(RBAC_PERMISSIONS).filter((p) =>
  p.endsWith(':owner'),
).length;

const cleanup = async () => {
  await serverDB.delete(userRoles);
  await serverDB.delete(rolePermissions);
  await serverDB.delete(permissions);
  await serverDB.delete(users);
  await serverDB.delete(roles);
};

describe('initializeRBAC', () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should seed the default role, backfill existing users, and stay idempotent', async () => {
    await serverDB.insert(users).values([{ id: 'rbac-user-1' }, { id: 'rbac-user-2' }]);

    const firstRun = await initializeRBAC(serverDB);
    const secondRun = await initializeRBAC(serverDB);

    const [defaultRole] = await serverDB
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.name, 'default'))
      .limit(1);

    const assignedUsers = await serverDB
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, defaultRole!.id));

    const seededPermissions = await serverDB.select({ code: permissions.code }).from(permissions);
    const grantedOwnerPermissions = await serverDB
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, defaultRole!.id));

    expect(firstRun.defaultRoleId).toBe(defaultRole!.id);
    expect(firstRun.assignedUserRoleCount).toBe(2);
    expect(secondRun.assignedUserRoleCount).toBe(0);
    expect(secondRun.defaultRoleId).toBe(firstRun.defaultRoleId);
    expect(seededPermissions).toHaveLength(Object.values(RBAC_PERMISSIONS).length);
    expect(grantedOwnerPermissions).toHaveLength(ownerPermissionCount);
    expect(assignedUsers).toHaveLength(2);
  });

  it('should work correctly with no existing users', async () => {
    const result = await initializeRBAC(serverDB);

    expect(result.assignedUserRoleCount).toBe(0);
    expect(result.seededPermissionCount).toBe(Object.values(RBAC_PERMISSIONS).length);
    expect(result.ownerPermissionCount).toBe(ownerPermissionCount);

    const [defaultRole] = await serverDB
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'default'))
      .limit(1);

    expect(defaultRole).toBeDefined();
    expect(result.defaultRoleId).toBe(defaultRole!.id);
  });

  it('should assign the default role to new users via database trigger', async () => {
    await initializeRBAC(serverDB);

    await serverDB.insert(users).values({ id: 'trigger-user' });

    const assignments = await serverDB
      .select({ roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, 'trigger-user'));

    expect(assignments).toEqual([{ roleName: 'default' }]);
  });
});
