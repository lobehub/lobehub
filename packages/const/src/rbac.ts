/**
 * RBAC Permission Actions Definition
 * Defines all executable permission action types in the system
 * Format: resource:action (e.g., agent:create, file:upload)
 */
export const PERMISSION_ACTIONS = {
  // ==================== Agent Management ====================
  AGENT_READ: 'agent:read',

  AGENT_CREATE: 'agent:create',

  AGENT_DELETE: 'agent:delete',

  AGENT_FORK: 'agent:fork',

  AGENT_UPDATE: 'agent:update',

  // ==================== AI Infrastructure Management ====================
  AI_MODEL_CREATE: 'ai_model:create',

  AI_MODEL_DELETE: 'ai_model:delete',

  AI_MODEL_READ: 'ai_model:read',

  AI_MODEL_UPDATE: 'ai_model:update',

  AI_MODEL_INVOKE: 'ai_model:invoke',

  AI_PROVIDER_CREATE: 'ai_provider:create',

  AI_PROVIDER_DELETE: 'ai_provider:delete',

  AI_PROVIDER_READ: 'ai_provider:read',

  AI_PROVIDER_UPDATE: 'ai_provider:update',

  // ==================== API Key Management ====================
  API_KEY_CREATE: 'api_key:create',

  API_KEY_DELETE: 'api_key:delete',

  API_KEY_READ: 'api_key:read',

  API_KEY_UPDATE: 'api_key:update',

  // ==================== Document Management ====================

  DOCUMENT_CREATE: 'document:create',

  DOCUMENT_DELETE: 'document:delete',

  DOCUMENT_READ: 'document:read',

  DOCUMENT_UPDATE: 'document:update',

  // ==================== File Management ====================
  FILE_DELETE: 'file:delete',

  FILE_READ: 'file:read',

  FILE_UPDATE: 'file:update',

  FILE_UPLOAD: 'file:upload',

  // ==================== Knowledge Base Management ====================
  KNOWLEDGE_BASE_CREATE: 'knowledge_base:create',

  KNOWLEDGE_BASE_DELETE: 'knowledge_base:delete',

  KNOWLEDGE_BASE_READ: 'knowledge_base:read',

  KNOWLEDGE_BASE_UPDATE: 'knowledge_base:update',

  // ==================== Message Management ====================
  MESSAGE_CREATE: 'message:create',

  MESSAGE_DELETE: 'message:delete',

  MESSAGE_READ: 'message:read',

  MESSAGE_UPDATE: 'message:update',

  // ==================== Translation Management ====================
  TRANSLATION_CREATE: 'translation:create',

  TRANSLATION_READ: 'translation:read',

  TRANSLATION_DELETE: 'translation:delete',

  TRANSLATION_UPDATE: 'translation:update',

  // ==================== RBAC Management ====================
  RBAC_PERMISSION_CREATE: 'rbac:permission_create',

  RBAC_PERMISSION_DELETE: 'rbac:permission_delete',

  RBAC_PERMISSION_READ: 'rbac:permission_read',

  RBAC_PERMISSION_UPDATE: 'rbac:permission_update',

  RBAC_ROLE_CREATE: 'rbac:role_create',

  RBAC_ROLE_DELETE: 'rbac:role_delete',

  RBAC_ROLE_READ: 'rbac:role_read',

  RBAC_ROLE_UPDATE: 'rbac:role_update',

  RBAC_USER_ROLE_READ: 'rbac:user_role_read',

  RBAC_USER_ROLE_UPDATE: 'rbac:user_role_update',

  RBAC_USER_ROLE_DELETE: 'rbac:user_role_delete',

  RBAC_USER_PERMISSION_READ: 'rbac:user_permission_read',

  RBAC_USER_PERMISSION_UPDATE: 'rbac:user_permission_update',

  // ==================== Session Management ====================
  SESSION_CREATE: 'session:create',

  SESSION_DELETE: 'session:delete',

  SESSION_READ: 'session:read',

  SESSION_UPDATE: 'session:update',

  // ==================== Session Group Management ====================
  SESSION_GROUP_CREATE: 'session_group:create',

  SESSION_GROUP_DELETE: 'session_group:delete',

  SESSION_GROUP_READ: 'session_group:read',

  SESSION_GROUP_UPDATE: 'session_group:update',

  // ==================== Topic Management ====================
  TOPIC_CREATE: 'topic:create',

  TOPIC_DELETE: 'topic:delete',

  TOPIC_READ: 'topic:read',

  TOPIC_UPDATE: 'topic:update',

  // ==================== Topic Comment Management ====================
  TOPIC_COMMENT_CREATE: 'topic_comment:create',

  TOPIC_COMMENT_DELETE: 'topic_comment:delete',

  TOPIC_COMMENT_READ: 'topic_comment:read',

  TOPIC_COMMENT_RESTORE: 'topic_comment:restore',

  TOPIC_COMMENT_UPDATE: 'topic_comment:update',

  // ==================== User Management ====================
  USER_CREATE: 'user:create',

  USER_DELETE: 'user:delete',

  USER_READ: 'user:read',

  USER_UPDATE: 'user:update',

  // ==================== Workspace Management ====================
  WORKSPACE_READ: 'workspace:read',

  WORKSPACE_UPDATE: 'workspace:update',

  WORKSPACE_DELETE: 'workspace:delete',

  WORKSPACE_SETTINGS_UPDATE: 'workspace:settings_update',

  WORKSPACE_BILLING_READ: 'workspace:billing_read',

  WORKSPACE_BILLING_MANAGE: 'workspace:billing_manage',

  // ==================== Workspace Member Management ====================
  WORKSPACE_MEMBER_READ: 'workspace_member:read',

  WORKSPACE_MEMBER_INVITE: 'workspace_member:invite',

  WORKSPACE_MEMBER_REMOVE: 'workspace_member:remove',

  WORKSPACE_MEMBER_UPDATE_ROLE: 'workspace_member:update_role',

  // ==================== Workspace Audit ====================
  WORKSPACE_AUDIT_READ: 'workspace_audit:read',

  // ==================== Workspace Role Management ====================
  WORKSPACE_ROLE_READ: 'workspace_role:read',

  WORKSPACE_ROLE_CREATE: 'workspace_role:create',

  WORKSPACE_ROLE_UPDATE: 'workspace_role:update',

  WORKSPACE_ROLE_DELETE: 'workspace_role:delete',
} as const;

/**
 * Operation Scope Constants Definition
 */
export const PERMISSION_SCOPE = ['ALL', 'OWNER'] as const;

export type PermissionScope = (typeof PERMISSION_SCOPE)[number];

/**
 * Calculate allowed scopes for a given permission action key.
 * Default policy: OWNER | ALL, with exceptions for system-level resources.
 */
export const getAllowedScopesForAction = (
  key: keyof typeof PERMISSION_ACTIONS,
): PermissionScope[] => {
  const value = PERMISSION_ACTIONS[key];
  const resource = value.split(':')[0];
  const action = value.split(':')[1];

  // RBAC resources: ALL only (system-level resource)
  if (resource === 'rbac') return ['ALL'];

  // Workspace-scoped resources: ALL only. The workspace itself is the isolation
  // boundary, so an "OWNER" sub-scope (resource-author-only) is redundant —
  // workspace_member.role + assigned permissions already pin who can do what.
  if (resource.startsWith('workspace')) return ['ALL'];

  // user resource nuance: create/delete without OWNER; read/update allow OWNER
  if (resource === 'user') {
    if (action === 'create' || action === 'delete') return ['ALL'];

    return ['ALL', 'OWNER'];
  }

  // Default: OWNER | ALL
  return ['ALL', 'OWNER'];
};

/**
 * RBAC System Permissions Definition
 * Combines permission actions with operation scopes to generate complete RBAC permission definitions
 * Format: resource:action:scope (e.g., agent:create:workspace, file:upload:owner)
 */
export const RBAC_PERMISSIONS = Object.entries(PERMISSION_ACTIONS).reduce(
  (acc, [key]) => {
    const actionKey = key as keyof typeof PERMISSION_ACTIONS;
    const permissionValue = PERMISSION_ACTIONS[actionKey];
    const allowedScopes = getAllowedScopesForAction(actionKey);

    const scoped = allowedScopes.reduce(
      (map, scope) => {
        const permissionWithScopeKey =
          `${key}_${scope}` as `${keyof typeof PERMISSION_ACTIONS}_${PermissionScope}`;
        map[permissionWithScopeKey] = `${permissionValue}:${scope.toLowerCase()}`;
        return map;
      },
      {} as Record<`${keyof typeof PERMISSION_ACTIONS}_${PermissionScope}`, string>,
    );

    return Object.assign(acc, scoped);
  },
  {} as Record<`${keyof typeof PERMISSION_ACTIONS}_${PermissionScope}`, string>,
);

/**
 * RBAC Permissions Key Type Definition
 */
export type RBAC_PERMISSIONS_KEY = keyof typeof RBAC_PERMISSIONS;

/**
 * ALL permission scope
 */
export const ALL_SCOPE = 'ALL';

/**
 * RBAC Role Constants Definition
 */
export const SYSTEM_DEFAULT_ROLES = {
  SUPER_ADMIN: 'super_admin',
} as const;

/**
 * Role Description Mapping
 */
export const ROLE_DESCRIPTIONS = {
  [SYSTEM_DEFAULT_ROLES.SUPER_ADMIN]: 'Administrator with all system permissions',
} as const;

/**
 * Built-in role names for workspace-scoped RBAC. Each workspace is seeded with
 * exactly these three system roles on creation; their `workspace_id` is the
 * owning workspace, distinguishing them from the global `super_admin` role.
 */
export const WORKSPACE_SYSTEM_ROLES = {
  OWNER: 'workspace_owner',
  MEMBER: 'workspace_member',
  VIEWER: 'workspace_viewer',
} as const;

export type WorkspaceSystemRoleName =
  (typeof WORKSPACE_SYSTEM_ROLES)[keyof typeof WORKSPACE_SYSTEM_ROLES];

const action = (key: keyof typeof PERMISSION_ACTIONS): string => PERMISSION_ACTIONS[key];

/**
 * Permission codes granted to each built-in workspace role. The lists are the
 * source of truth used both by `seedWorkspaceRoles` (DB seeding) and the
 * migration backfill SQL — keep them aligned.
 *
 * Scope semantics:
 * - `workspace_owner` — every workspace-domain permission + every content
 *   permission (`:all`) so they can manage other members' resources too.
 * - `workspace_member` — read workspace + members; create/update/delete their
 *   own content (`:owner`) on every content resource.
 * - `workspace_viewer` — strict read-only on workspace + members + content.
 *   No model invocation: chat without SESSION/MESSAGE write grants would
 *   either burn workspace budget without persisting history or require
 *   special-case bypasses. Use `workspace_member` if "can chat" is needed.
 */
export const WORKSPACE_ROLE_PERMISSIONS: Record<WorkspaceSystemRoleName, readonly string[]> = {
  [WORKSPACE_SYSTEM_ROLES.OWNER]: [
    // Workspace
    `${action('WORKSPACE_READ')}:all`,
    `${action('WORKSPACE_UPDATE')}:all`,
    `${action('WORKSPACE_DELETE')}:all`,
    `${action('WORKSPACE_SETTINGS_UPDATE')}:all`,
    `${action('WORKSPACE_BILLING_READ')}:all`,
    `${action('WORKSPACE_BILLING_MANAGE')}:all`,
    // Members
    `${action('WORKSPACE_MEMBER_READ')}:all`,
    `${action('WORKSPACE_MEMBER_INVITE')}:all`,
    `${action('WORKSPACE_MEMBER_REMOVE')}:all`,
    `${action('WORKSPACE_MEMBER_UPDATE_ROLE')}:all`,
    // Audit
    `${action('WORKSPACE_AUDIT_READ')}:all`,
    // Custom roles
    `${action('WORKSPACE_ROLE_READ')}:all`,
    `${action('WORKSPACE_ROLE_CREATE')}:all`,
    `${action('WORKSPACE_ROLE_UPDATE')}:all`,
    `${action('WORKSPACE_ROLE_DELETE')}:all`,
    // Content — owner can read/write everyone's resources
    `${action('AGENT_READ')}:all`,
    `${action('AGENT_CREATE')}:all`,
    `${action('AGENT_UPDATE')}:all`,
    `${action('AGENT_DELETE')}:all`,
    `${action('AGENT_FORK')}:all`,
    `${action('SESSION_READ')}:all`,
    `${action('SESSION_CREATE')}:all`,
    `${action('SESSION_UPDATE')}:all`,
    `${action('SESSION_DELETE')}:all`,
    `${action('SESSION_GROUP_READ')}:all`,
    `${action('SESSION_GROUP_CREATE')}:all`,
    `${action('SESSION_GROUP_UPDATE')}:all`,
    `${action('SESSION_GROUP_DELETE')}:all`,
    `${action('MESSAGE_READ')}:all`,
    `${action('MESSAGE_CREATE')}:all`,
    `${action('MESSAGE_UPDATE')}:all`,
    `${action('MESSAGE_DELETE')}:all`,
    `${action('TOPIC_READ')}:all`,
    `${action('TOPIC_CREATE')}:all`,
    `${action('TOPIC_UPDATE')}:all`,
    `${action('TOPIC_DELETE')}:all`,
    `${action('TOPIC_COMMENT_READ')}:all`,
    `${action('TOPIC_COMMENT_CREATE')}:all`,
    `${action('TOPIC_COMMENT_UPDATE')}:all`,
    `${action('TOPIC_COMMENT_DELETE')}:all`,
    `${action('TOPIC_COMMENT_RESTORE')}:all`,
    `${action('FILE_READ')}:all`,
    `${action('FILE_UPLOAD')}:all`,
    `${action('FILE_UPDATE')}:all`,
    `${action('FILE_DELETE')}:all`,
    `${action('DOCUMENT_READ')}:all`,
    `${action('DOCUMENT_CREATE')}:all`,
    `${action('DOCUMENT_UPDATE')}:all`,
    `${action('DOCUMENT_DELETE')}:all`,
    `${action('KNOWLEDGE_BASE_READ')}:all`,
    `${action('KNOWLEDGE_BASE_CREATE')}:all`,
    `${action('KNOWLEDGE_BASE_UPDATE')}:all`,
    `${action('KNOWLEDGE_BASE_DELETE')}:all`,
    `${action('AI_MODEL_READ')}:all`,
    `${action('AI_MODEL_INVOKE')}:all`,
    `${action('AI_MODEL_CREATE')}:all`,
    `${action('AI_MODEL_UPDATE')}:all`,
    `${action('AI_MODEL_DELETE')}:all`,
    `${action('AI_PROVIDER_READ')}:all`,
    `${action('AI_PROVIDER_CREATE')}:all`,
    `${action('AI_PROVIDER_UPDATE')}:all`,
    `${action('AI_PROVIDER_DELETE')}:all`,
    `${action('API_KEY_READ')}:all`,
    `${action('API_KEY_CREATE')}:all`,
    `${action('API_KEY_UPDATE')}:all`,
    `${action('API_KEY_DELETE')}:all`,
  ],
  [WORKSPACE_SYSTEM_ROLES.MEMBER]: [
    // Workspace — read only
    `${action('WORKSPACE_READ')}:all`,
    `${action('WORKSPACE_MEMBER_READ')}:all`,
    // Content — can write own
    `${action('AGENT_READ')}:all`,
    `${action('AGENT_CREATE')}:owner`,
    `${action('AGENT_UPDATE')}:owner`,
    `${action('AGENT_DELETE')}:owner`,
    `${action('AGENT_FORK')}:owner`,
    `${action('SESSION_READ')}:all`,
    `${action('SESSION_CREATE')}:owner`,
    `${action('SESSION_UPDATE')}:owner`,
    `${action('SESSION_DELETE')}:owner`,
    `${action('SESSION_GROUP_READ')}:all`,
    `${action('SESSION_GROUP_CREATE')}:owner`,
    `${action('SESSION_GROUP_UPDATE')}:owner`,
    `${action('SESSION_GROUP_DELETE')}:owner`,
    `${action('MESSAGE_READ')}:all`,
    `${action('MESSAGE_CREATE')}:owner`,
    `${action('MESSAGE_UPDATE')}:owner`,
    `${action('MESSAGE_DELETE')}:owner`,
    `${action('TOPIC_READ')}:all`,
    `${action('TOPIC_CREATE')}:owner`,
    `${action('TOPIC_UPDATE')}:owner`,
    `${action('TOPIC_DELETE')}:owner`,
    `${action('TOPIC_COMMENT_READ')}:all`,
    `${action('TOPIC_COMMENT_CREATE')}:owner`,
    `${action('TOPIC_COMMENT_UPDATE')}:owner`,
    `${action('TOPIC_COMMENT_DELETE')}:owner`,
    `${action('FILE_READ')}:all`,
    `${action('FILE_UPLOAD')}:owner`,
    `${action('FILE_UPDATE')}:owner`,
    `${action('FILE_DELETE')}:owner`,
    `${action('DOCUMENT_READ')}:all`,
    `${action('DOCUMENT_CREATE')}:owner`,
    `${action('DOCUMENT_UPDATE')}:owner`,
    `${action('DOCUMENT_DELETE')}:owner`,
    `${action('KNOWLEDGE_BASE_READ')}:all`,
    `${action('KNOWLEDGE_BASE_CREATE')}:owner`,
    `${action('KNOWLEDGE_BASE_UPDATE')}:owner`,
    `${action('KNOWLEDGE_BASE_DELETE')}:owner`,
    `${action('AI_MODEL_READ')}:all`,
    `${action('AI_MODEL_INVOKE')}:all`,
    `${action('AI_PROVIDER_READ')}:all`,
  ],
  [WORKSPACE_SYSTEM_ROLES.VIEWER]: [
    // Read-only across the board
    `${action('WORKSPACE_READ')}:all`,
    `${action('WORKSPACE_MEMBER_READ')}:all`,
    `${action('AGENT_READ')}:all`,
    `${action('SESSION_READ')}:all`,
    `${action('SESSION_GROUP_READ')}:all`,
    `${action('MESSAGE_READ')}:all`,
    `${action('TOPIC_READ')}:all`,
    `${action('TOPIC_COMMENT_READ')}:all`,
    `${action('FILE_READ')}:all`,
    `${action('DOCUMENT_READ')}:all`,
    `${action('KNOWLEDGE_BASE_READ')}:all`,
    `${action('AI_MODEL_READ')}:all`,
    `${action('AI_PROVIDER_READ')}:all`,
  ],
};

export const WORKSPACE_ROLE_DESCRIPTIONS: Record<WorkspaceSystemRoleName, string> = {
  [WORKSPACE_SYSTEM_ROLES.OWNER]: 'Full access including billing, members, and all content.',
  [WORKSPACE_SYSTEM_ROLES.MEMBER]: 'Can create and edit own content, read shared content.',
  [WORKSPACE_SYSTEM_ROLES.VIEWER]: 'Read-only access to workspace content.',
};

export const WORKSPACE_ROLE_DISPLAY_NAMES: Record<WorkspaceSystemRoleName, string> = {
  [WORKSPACE_SYSTEM_ROLES.OWNER]: 'Owner',
  [WORKSPACE_SYSTEM_ROLES.MEMBER]: 'Member',
  [WORKSPACE_SYSTEM_ROLES.VIEWER]: 'Viewer',
};

/**
 * Translate a legacy `workspace_members.role` text value to its corresponding
 * built-in role name. Used by the migration backfill and member CRUD code that
 * still double-writes to `workspace_members.role` for label/UI purposes.
 */
export const legacyRoleToWorkspaceRole = (role: string): WorkspaceSystemRoleName | null => {
  switch (role) {
    case 'owner': {
      return WORKSPACE_SYSTEM_ROLES.OWNER;
    }
    case 'member': {
      return WORKSPACE_SYSTEM_ROLES.MEMBER;
    }
    case 'viewer': {
      return WORKSPACE_SYSTEM_ROLES.VIEWER;
    }
    default: {
      return null;
    }
  }
};
