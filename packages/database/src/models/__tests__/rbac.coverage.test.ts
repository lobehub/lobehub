// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { permissions, rolePermissions, roles, userRoles, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { RbacModel } from '../rbac';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 't863-rbac-cov-user';
const workspaceId = 't863-rbac-cov-ws';
const globalRole = 't863-rbac-cov-global';
const workspaceRole = 't863-rbac-cov-workspace';
const globalCode = 't863-rbac-cov:global';
const workspaceCode = 't863-rbac-cov:workspace';

const rbacModel = new RbacModel(serverDB, userId);

/** Grant the user a role holding one permission, either globally or for one workspace. */
const grantRole = async (roleName: string, code: string, grantWorkspaceId: string | null) => {
  const [role] = await serverDB
    .insert(roles)
    .values({ displayName: roleName, isActive: true, name: roleName })
    .returning({ id: roles.id });
  const [permission] = await serverDB
    .insert(permissions)
    .values({ category: 't863', code, isActive: true, name: code })
    .returning({ id: permissions.id });
  await serverDB.insert(rolePermissions).values({ permissionId: permission.id, roleId: role.id });
  await serverDB
    .insert(userRoles)
    .values({ roleId: role.id, userId, workspaceId: grantWorkspaceId });
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'W', primaryOwnerId: userId, slug: 't863-rbac-cov' });
});

afterEach(async () => {
  // Roles and permissions are not owned by a user, so drop them explicitly; role
  // grants and role-permission links cascade with them.
  await serverDB.delete(roles).where(inArray(roles.name, [globalRole, workspaceRole]));
  await serverDB.delete(permissions).where(inArray(permissions.code, [globalCode, workspaceCode]));
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('RbacModel coverage', () => {
  describe('workspace mode only reads globally-granted roles', () => {
    beforeEach(async () => {
      await grantRole(globalRole, globalCode, null);
      await grantRole(workspaceRole, workspaceCode, workspaceId);
    });

    it('getUserPermissionDetails', async () => {
      const details = await rbacModel.getUserPermissionDetails({ workspaceId });

      expect(details.map((row) => [row.roleName, row.permissionCode])).toEqual([
        [globalRole, globalCode],
      ]);
    });

    it('getUserRoles', async () => {
      const result = await rbacModel.getUserRoles({ workspaceId });

      expect(result.map((role) => role.name)).toEqual([globalRole]);
    });

    it('getUserRoles in personal mode keeps workspace-scoped grants too', async () => {
      const result = await rbacModel.getUserRoles();

      expect(result.map((role) => role.name).sort()).toEqual([globalRole, workspaceRole].sort());
    });
  });

  it('denies a personal-mode check when the driver returns the count as a number', async () => {
    // node-postgres hands `count(*)` back as the string '0'; a driver that parses
    // bigint into a number yields a falsy 0, which must still read as "no grant".
    const numericCountDB = createProxyTestDB(serverDB, (query, result) =>
      query.includes('count(*)') ? result.rows.map((row) => row.map(Number)) : result.rows,
    );
    const model = new RbacModel(numericCountDB, userId);

    await expect(model.hasAnyPermission([globalCode])).resolves.toBe(false);
  });
});
