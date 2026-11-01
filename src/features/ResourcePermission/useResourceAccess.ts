import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { cacheScope } from '@/libs/replica';
import type { PermissionResourceType } from '@/services/resourcePermission';
import {
  resourcePermissionActions,
  resourcePermissionSelectors,
  useResourcePermissionStore,
} from '@/store/resourcePermission';

/**
 * Read-side derivation of the workspace General-access level for a resource.
 *
 * The record is a replica: after a reload, edit/use checks resolve from the
 * last confirmed value on the first frame while it revalidates, so config
 * pages, menus and composer controls do not wait for the network. The server
 * still checks every write.
 *
 * Edit/use checks stay permissive while workspace access is loading so chat
 * input does not flash disabled. A server-confirmed creator/admin (`canManage`)
 * bypasses the public resource's Member Permissions. Management checks are
 * deliberately fail-closed: a persisted grant may predate a downgrade, so
 * destructive/ownership controls wait until this session has re-fetched it
 * (`isAccessConfirmed`). A denial answered this session fails every check
 * closed. Personal mode keeps full access.
 */
export const useResourceAccess = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
) => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const enabled = hasActiveWorkspace && !!resourceId;
  const ref = enabled ? { resourceId: resourceId!, resourceType } : null;

  const scope = cacheScope.use();
  const { error, revalidate } = resourcePermissionActions.useFetchAccess(ref);
  const data = useResourcePermissionStore(resourcePermissionSelectors.access(ref));
  const sessionCheck = useResourcePermissionStore(
    resourcePermissionSelectors.sessionCheck(ref, scope),
  );

  const isDenied = enabled && sessionCheck === 'denied';
  // The server answered this session — a grant re-fetched, or a denial.
  const isAccessConfirmed = !enabled || isDenied || (!!data && sessionCheck === 'confirmed');

  return {
    /** The record on screen (persisted or fresh); `undefined` until one exists. */
    access: enabled && !isDenied ? data : undefined,
    accessError: error,
    canEditResource:
      !enabled || (!isDenied && (!data ? true : data.canManage || data.accessLevel === 'edit')),
    canManageResource: !enabled || (!isDenied && isAccessConfirmed && data?.canManage === true),
    canUseResource:
      !enabled || (!isDenied && (!data ? true : data.canManage || data.accessLevel !== 'view')),
    isAccessConfirmed,
    isAccessResolved: !enabled || isDenied || !!data,
    /** First load only: a persisted record is not "loading". */
    isLoading: enabled && !data && !isDenied && !error,
    retryAccess: revalidate,
  };
};
