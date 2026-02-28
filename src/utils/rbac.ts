import {
  PERMISSION_ACTIONS,
  type PermissionScope,
  RBAC_PERMISSIONS,
  getAllowedScopesForAction,
} from '@/const/rbac';

/**
 * 获取指定权限的所有scope权限值数组
 * 直接从预编译的 RBAC_PERMISSIONS 中提取权限码
 * @param key 权限动作键名
 * @returns 权限值数组
 */
export function getAllScopePermissions(key: keyof typeof PERMISSION_ACTIONS): string[] {
  // 获取允许的scope，有些资源只有all/workspace权限级别的scope
  const allowed = getAllowedScopesForAction(key);

  return allowed
    .map((scope) => {
      const permissionKey = `${key}_${scope}` as keyof typeof RBAC_PERMISSIONS;
      return RBAC_PERMISSIONS[permissionKey];
    })
    .filter(Boolean);
}

/**
 * 获取指定权限的特定scope权限值数组
 * 直接从预编译的 RBAC_PERMISSIONS 中提取权限码
 * @param key 权限动作键名
 * @param scopes 需要的scope数组
 * @returns 权限值数组
 */
export function getScopePermissions(
  key: keyof typeof PERMISSION_ACTIONS,
  scopes: PermissionScope[],
): string[] {
  // 获取允许的scope，有些资源只有all/workspace权限级别的scope
  const allowed = new Set(getAllowedScopesForAction(key));

  // 过滤掉不允许的scope
  return scopes
    .filter((scope) => allowed.has(scope))
    .map((scope) => {
      const permissionKey = `${key}_${scope}` as keyof typeof RBAC_PERMISSIONS;
      return RBAC_PERMISSIONS[permissionKey];
    })
    .filter(Boolean);
}
