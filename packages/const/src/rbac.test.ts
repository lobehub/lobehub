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
      ]),
    );
    expect(admin).not.toEqual(
      expect.arrayContaining(['workspace:billing_manage:all', 'workspace:delete:all']),
    );
  });

  // Agent curation is an Admin job, so `AGENT_UPDATE:all` is what lets
  // `canPerformResourceAction` bypass a shared Agent's Member Permissions —
  // General Access constrains members and viewers, not the Admin. Destroying
  // or rehoming someone else's Agent stays Owner/creator-only.
  it('lets Admin curate other members Agents without granting destructive rights', () => {
    const admin = WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.ADMIN];

    expect(admin).toContain('agent:update:all');
    expect(admin).not.toContain('agent:update:owner');
    expect(admin).toContain('agent:delete:owner');
    expect(admin).not.toContain('agent:delete:all');
  });

  it('keeps every non-Agent content resource owner-scoped for Admin', () => {
    const admin = WORKSPACE_ROLE_PERMISSIONS[WORKSPACE_SYSTEM_ROLES.ADMIN];

    for (const code of ['document:update:all', 'knowledge_base:update:all', 'file:update:all']) {
      expect(admin).not.toContain(code);
    }
  });
});
