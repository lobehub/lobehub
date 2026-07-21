import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useClientDataSWR } from '@/libs/swr';
import type { PermissionResourceType } from '@/services/resourcePermission';
import { resourcePermissionService } from '@/services/resourcePermission';

// Same SWR key as useResourcePermission so both hooks share one fetch/cache entry.
const FETCH_RESOURCE_PERMISSION_KEY = 'resource-permission';

/**
 * Read-side derivation of the workspace General-access level for a resource.
 *
 * Edit/use checks stay permissive while workspace access is loading so chat
 * input does not flash disabled. Management checks are deliberately
 * fail-closed: destructive/ownership controls must not appear until the
 * server confirms creator/owner access. Personal mode keeps full access.
 */
export const useResourceAccess = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
) => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const enabled = hasActiveWorkspace && !!resourceId;

  const { data, error, isLoading, mutate } = useClientDataSWR(
    enabled ? [FETCH_RESOURCE_PERMISSION_KEY, resourceType, resourceId] : null,
    () => resourcePermissionService.getGeneralAccess(resourceType, resourceId!),
  );

  return {
    accessError: error,
    canEditResource: !enabled || !data ? true : data.canManage || data.accessLevel === 'edit',
    canManageResource: !enabled || data?.canManage === true,
    canUseResource: !enabled || !data ? true : data.canManage || data.accessLevel !== 'view',
    isAccessResolved: !enabled || !!data,
    isLoading,
    retryAccess: mutate,
  };
};
