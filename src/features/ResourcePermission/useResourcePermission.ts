import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cacheScope } from '@/libs/replica';
import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';
import {
  resourcePermissionActions,
  resourcePermissionSelectors,
  useResourcePermissionStore,
} from '@/store/resourcePermission';

/**
 * State + handlers of the Permission panel: publicity and the workspace
 * General-access level (Notion-style Share). Reads the same access replica as
 * `useResourceAccess`, so a reload paints the last confirmed level at once.
 */
export const useResourcePermission = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
) => {
  const { t } = useTranslation('setting');

  const [updating, setUpdating] = useState(false);

  const ref = resourceId ? { resourceId, resourceType } : null;
  const scope = cacheScope.use();
  const { error, revalidate } = resourcePermissionActions.useFetchAccess(ref);
  const data = useResourcePermissionStore(resourcePermissionSelectors.access(ref));
  const sessionCheck = useResourcePermissionStore(
    resourcePermissionSelectors.sessionCheck(ref, scope),
  );

  const setAccessLevel = useCallback(
    async (accessLevel: ResourceAccessLevel) => {
      if (!data || !resourceId) return;
      setUpdating(true);
      try {
        await resourcePermissionActions.setAccessLevel({ resourceId, resourceType }, accessLevel);
      } catch (e) {
        console.error('[ResourcePermission]', e);
        toast.error((e as Error)?.message || t('permission.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [data, resourceId, resourceType, t],
  );

  return {
    data,
    error,
    /** The server answered this record during this session (not only a persisted copy). */
    isConfirmed: !!data && sessionCheck === 'confirmed',
    /** First load only: a persisted record is not "loading". */
    isLoading: !!ref && !data && !error,
    /** Re-fetch — used by the Permission page to retry a failed load. */
    mutate: revalidate,
    setAccessLevel,
    updating,
  };
};
