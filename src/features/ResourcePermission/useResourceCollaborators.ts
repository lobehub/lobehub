import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';
import {
  resourcePermissionActions,
  resourcePermissionSelectors,
  useResourcePermissionStore,
} from '@/store/resourcePermission';

/**
 * The collaborator grants of one resource, with add/remove handlers for the
 * Permission page. Only fetch when the caller manages the resource — the
 * server rejects everyone else. The list is memory-only: it holds what this
 * session fetched, never a persisted roster from before a lost grant.
 */
export const useResourceCollaborators = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
  options?: { enabled?: boolean },
) => {
  const { t } = useTranslation('setting');
  const enabled = options?.enabled ?? true;

  const [mutating, setMutating] = useState(false);

  const ref = resourceId && enabled ? { resourceId, resourceType } : null;
  const { error, revalidate } = resourcePermissionActions.useFetchCollaborators(ref);
  const data = useResourcePermissionStore(resourcePermissionSelectors.collaborators(ref));

  /**
   * Run a mutation, reporting whether it succeeded. The failure is surfaced as
   * a toast here, but the boolean still matters: a caller that dismisses a
   * surface on completion must branch on it, or a rejected mutation reads
   * exactly like a successful one and takes the user's unsaved input down
   * with it.
   */
  const run = useCallback(
    async (action: () => Promise<void>): Promise<boolean> => {
      setMutating(true);
      try {
        await action();
        return true;
      } catch (e) {
        console.error('[ResourceCollaborators]', e);
        toast.error((e as Error)?.message || t('permission.updateError'));
        return false;
      } finally {
        setMutating(false);
      }
    },
    [t],
  );

  const addCollaborators = useCallback(
    (userIds: string[], accessLevel: ResourceAccessLevel): Promise<boolean> => {
      if (!resourceId || userIds.length === 0) return Promise.resolve(false);
      return run(() =>
        resourcePermissionActions.addCollaborators(
          { resourceId, resourceType },
          userIds,
          accessLevel,
        ),
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
      await run(() =>
        resourcePermissionActions.removeCollaborator({ resourceId, resourceType }, userId),
      );
    },
    [run, resourceType, resourceId],
  );

  return {
    addCollaborators,
    collaborators: data,
    error,
    /** First load only: a list already fetched this session is not "loading". */
    isLoading: !!ref && !data && !error,
    mutate: revalidate,
    mutating,
    removeCollaborator,
  };
};
