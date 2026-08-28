import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';
import { resourcePermissionService } from '@/services/resourcePermission';

const FETCH_RESOURCE_COLLABORATORS_KEY = 'resource-collaborators';

/**
 * The collaborator grants of one resource, with add/remove handlers for the
 * Permission page. Only fetch when the caller manages the resource — the
 * server rejects everyone else.
 */
export const useResourceCollaborators = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
  options?: { enabled?: boolean },
) => {
  const { t } = useTranslation('setting');
  const enabled = options?.enabled ?? true;

  const [mutating, setMutating] = useState(false);

  const { data, error, isLoading, mutate } = useClientDataSWR(
    resourceId && enabled ? [FETCH_RESOURCE_COLLABORATORS_KEY, resourceType, resourceId] : null,
    () => resourcePermissionService.listCollaborators(resourceType, resourceId!),
  );

  /**
   * Run a mutation and refresh the list, reporting whether it succeeded. The
   * failure is surfaced as a toast here, but the boolean still matters: a
   * caller that dismisses a surface on completion must branch on it, or a
   * rejected mutation reads exactly like a successful one and takes the
   * user's unsaved input down with it.
   */
  const run = useCallback(
    async (action: () => Promise<void>): Promise<boolean> => {
      setMutating(true);
      try {
        await action();
        await mutate();
        return true;
      } catch (e) {
        console.error('[ResourceCollaborators]', e);
        toast.error((e as Error)?.message || t('permission.updateError'));
        return false;
      } finally {
        setMutating(false);
      }
    },
    [mutate, t],
  );

  const addCollaborators = useCallback(
    (userIds: string[], accessLevel: ResourceAccessLevel): Promise<boolean> => {
      if (!resourceId || userIds.length === 0) return Promise.resolve(false);
      return run(() =>
        resourcePermissionService.addCollaborators(resourceType, resourceId, userIds, accessLevel),
      );
    },
    [run, resourceType, resourceId],
  );

  /**
   * Optimistic removal: the row disappears immediately, the grant is revoked
   * in the background, and a failure rolls the row back with a toast — never
   * a silent rollback.
   */
  const removeCollaborator = useCallback(
    async (userId: string) => {
      if (!resourceId) return;
      const previous = data;
      setMutating(true);
      await mutate(
        (previous ?? []).filter((item) => item.userId !== userId),
        false,
      );
      try {
        await resourcePermissionService.removeCollaborator(resourceType, resourceId, userId);
        await mutate();
      } catch (e) {
        await mutate(previous, false);
        console.error('[ResourceCollaborators]', e);
        toast.error((e as Error)?.message || t('permission.updateError'));
      } finally {
        setMutating(false);
      }
    },
    [data, mutate, t, resourceType, resourceId],
  );

  return {
    addCollaborators,
    collaborators: data,
    error,
    isLoading,
    mutate,
    mutating,
    removeCollaborator,
  };
};
