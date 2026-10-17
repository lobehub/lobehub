import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { resourcePermissionKeys } from '@/libs/swr/keys';
import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';
import { resourcePermissionService } from '@/services/resourcePermission';

import type { FetchedGeneralAccess } from './useResourceAccess';
import { fetchGeneralAccess, stampFetchedAccess } from './useResourceAccess';

/**
 * State + handlers of the Permission panel: publicity and the workspace
 * General-access level (Notion-style Share).
 */
export const useResourcePermission = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
) => {
  const { t } = useTranslation('setting');

  const [updating, setUpdating] = useState(false);

  const { data, error, isLoading, mutate } = useClientDataSWR(
    resourceId ? resourcePermissionKeys.generalAccess(resourceType, resourceId) : null,
    () => fetchGeneralAccess(resourceType, resourceId!),
  );

  const run = useCallback(
    async (
      action: () => Promise<Awaited<ReturnType<typeof resourcePermissionService.getGeneralAccess>>>,
      optimisticData: FetchedGeneralAccess,
    ) => {
      const previousData = data;
      setUpdating(true);
      await mutate(optimisticData, false);
      try {
        // A write's response is a fresh server answer too; stamp it so the
        // persisted row ages from now rather than counting as expired.
        const result = await action();
        await mutate(stampFetchedAccess(result), false);
      } catch (e) {
        await mutate(previousData, false);
        console.error('[ResourcePermission]', e);
        toast.error((e as Error)?.message || t('permission.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [data, mutate, t],
  );

  const setAccessLevel = useCallback(
    (accessLevel: ResourceAccessLevel) => {
      if (!data) return;
      return run(
        () => resourcePermissionService.setAccessLevel(resourceType, resourceId!, accessLevel),
        {
          ...data,
          accessLevel,
          generalAccess: accessLevel === 'edit' ? 'editor' : 'viewer',
        },
      );
    },
    [data, run, resourceType, resourceId],
  );

  return {
    data,
    error,
    isLoading,
    /** Re-fetch — used by the Permission page to retry a failed load. */
    mutate,
    setAccessLevel,
    updating,
  };
};
