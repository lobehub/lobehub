/* eslint-disable sort-keys-fix/sort-keys-fix  */

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

  // ==================== User Management ====================
  USER_CREATE: 'user:create',

  USER_DELETE: 'user:delete',

  USER_READ: 'user:read',

  USER_UPDATE: 'user:update',
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
