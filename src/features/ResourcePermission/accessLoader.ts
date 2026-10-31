import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import type { PermissionResourceType } from '@/services/resourcePermission';
import { resourcePermissionActions } from '@/store/resourcePermission';

/**
 * Route loader body: seed the persisted access record of the route's resource.
 *
 * Route loaders run before React commits the route, the only point where this
 * async IndexedDB read can land before `ResourceConfigAccessGate` renders. A
 * resource with no persisted record (first visit, personal mode) is a harmless
 * miss, and the gate then waits for the server as before.
 */
export const preHydrateResourceAccess = async (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
): Promise<null> => {
  if (resourceId) {
    await settleWithin(
      resourcePermissionActions.preHydrateAccess({ resourceId, resourceType }),
      PRE_PAINT_HYDRATE_TIMEOUT,
    );
  }

  return null;
};
