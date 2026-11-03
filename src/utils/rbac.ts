import type { PERMISSION_ACTIONS, PermissionScope } from '@/const/rbac';
import { getAllowedScopesForAction, RBAC_PERMISSIONS } from '@/const/rbac';

/**
 * Get all scope permission value arrays for a given permission
 * Extracts permission codes directly from the precompiled RBAC_PERMISSIONS
 * @param key Permission action key name
 * @returns Array of permission values
 */
export function getAllScopePermissions(key: keyof typeof PERMISSION_ACTIONS): string[] {
  // Get allowed scopes; some resources only have all/workspace scope levels
  const allowed = getAllowedScopesForAction(key);

  return allowed
    .map((scope) => {
      const permissionKey = `${key}_${scope}` as keyof typeof RBAC_PERMISSIONS;
      return RBAC_PERMISSIONS[permissionKey];
    })
    .filter(Boolean);
}

/**
 * Get specific scope permission value arrays for a given permission
 * Extracts permission codes directly from the precompiled RBAC_PERMISSIONS
 * @param key Permission action key name
 * @param scopes Array of required scopes
 * @returns Array of permission values
 */
export function getScopePermissions(
  key: keyof typeof PERMISSION_ACTIONS,
  scopes: PermissionScope[],
): string[] {
  // Get allowed scopes; some resources only have all/workspace scope levels
  const allowed = new Set(getAllowedScopesForAction(key));

  // Filter out disallowed scopes
  return scopes
    .filter((scope) => allowed.has(scope))
    .map((scope) => {
      const permissionKey = `${key}_${scope}` as keyof typeof RBAC_PERMISSIONS;
      return RBAC_PERMISSIONS[permissionKey];
    })
    .filter(Boolean);
}
