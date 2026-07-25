import { describe, expect, it } from 'vitest';

import {
  legacyRoleToWorkspaceRole,
  WORKSPACE_ROLE_PERMISSIONS,
  WORKSPACE_SYSTEM_ROLES,
} from './rbac';

describe('workspace built-in roles', () => {
  it('defines the four-role hierarchy including the standalone Admin role', () => {
    expect(WORKSPACE_SYSTEM_ROLES).toEqual({
      ADMIN: 'workspace_admin',
      MEMBER: 'workspace_member',
      OWNER: 'workspace_owner',
      VIEWER: 'workspace_viewer',
    });
    expect(legacyRoleToWorkspaceRole('admin')).toBe(WORKSPACE_SYSTEM_ROLES.ADMIN);
  });

  it('keeps Admin management rights below the unique Owner boundary', () => {
    const admin = WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.ADMIN];

    expect(admin).toEqual(
      expect.arrayContaining([
        'workspace:update:all',
        'workspace_member:update_role:all',
        'workspace_audit:read:all',
        'api_key:update:all',
        'agent:update:owner',
      ]),
    );
    expect(admin).not.toEqual(
      expect.arrayContaining([
        'workspace:billing_manage:all',
        'workspace:delete:all',
        'agent:update:all',
      ]),
    );
  });
});
