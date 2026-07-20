import { App } from 'antd';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';
import { resourcePermissionService } from '@/services/resourcePermission';

const FETCH_RESOURCE_PERMISSION_KEY = 'resource-permission';

/**
 * State + handlers of the Permission panel: publicity and the workspace
 * General-access level (Notion-style Share).
 */
export const useResourcePermission = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
) => {
  const { t } = useTranslation('setting');
  const { message } = App.useApp();
  const [updating, setUpdating] = useState(false);

  const { data, error, isLoading, mutate } = useClientDataSWR(
    resourceId ? [FETCH_RESOURCE_PERMISSION_KEY, resourceType, resourceId] : null,
    () => resourcePermissionService.getGeneralAccess(resourceType, resourceId!),
  );

  const run = useCallback(
    async (
      action: () => Promise<Awaited<ReturnType<typeof resourcePermissionService.getGeneralAccess>>>,
      optimisticData: Awaited<ReturnType<typeof resourcePermissionService.getGeneralAccess>>,
    ) => {
      const previousData = data;
      setUpdating(true);
      await mutate(optimisticData, false);
      try {
        const result = await action();
        await mutate(result, false);
      } catch (e) {
        await mutate(previousData, false);
        console.error('[ResourcePermission]', e);
        message.error((e as Error)?.message || t('permission.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [data, mutate, message, t],
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
    setAccessLevel,
    updating,
  };
};
