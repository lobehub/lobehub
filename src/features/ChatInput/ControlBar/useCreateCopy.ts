import { useCallback } from 'react';

import { sandboxStorageService } from '@/services/sandboxStorage';

import { usePendingIds } from './usePendingIds';
import type { SandboxSelection } from './useSandboxMode';

type ListedInstances = Awaited<ReturnType<typeof sandboxStorageService.listInstances>>;

interface UseCreateCopyOptions {
  /** The build could not be started; the copy exists and stays bound. */
  onBuildError: (error: unknown) => void;
  onChange: (selection: SandboxSelection) => Promise<void>;
  /** The picker's SWR `mutate` for the instance list. */
  refreshInstances: (
    update?: (previous: ListedInstances | undefined) => ListedInstances | undefined,
    options?: { revalidate: boolean },
  ) => Promise<unknown>;
  topicId?: string;
}

/**
 * A new copy of an environment, bound to this conversation and built.
 *
 * One path for both ways the composer makes a copy: an environment from before
 * every environment got a default copy, picked for the first time, and "open
 * another copy" when the ones there are taken. Built from the environment's
 * specification — the busy copy's state belongs to the run holding it — with the
 * name and folder derived server-side, so there is nothing to ask.
 *
 * The copy is listed and bound before its build is even started, so it shows up
 * as "Building" at once rather than after the build's cold start.
 */
export const useCreateCopy = ({
  onBuildError,
  onChange,
  refreshInstances,
  topicId,
}: UseCreateCopyOptions) => {
  // Environments a copy is being made for.
  const preparing = usePendingIds();

  const create = useCallback(
    /** `onCreateError`: no copy was made, so nothing was bound. */
    async (environmentId: string, onCreateError: (error: unknown) => void) => {
      preparing.add(environmentId);
      try {
        const created = await sandboxStorageService.createInstanceForEnvironment({
          environmentId,
        });
        await refreshInstances(
          (previous) =>
            previous && {
              ...previous,
              instances: [
                ...previous.instances,
                {
                  buildError: null,
                  buildId: null,
                  buildable: true,
                  createdAt: created.createdAt,
                  environmentId: created.environmentId,
                  id: created.id,
                  inUse: false,
                  inUseByThisTopic: false,
                  // Never the default beside others: it is the newest. Alone it
                  // is the only one, and the next listing marks it so.
                  isDefault: previous.instances.every(
                    (instance) => instance.environmentId !== environmentId,
                  ),
                  name: created.name,
                  snapshot: null,
                  status: 'pending' as const,
                  workingDirectory: created.workingDirectory,
                },
              ],
            },
          { revalidate: false },
        );
        await onChange({ instanceId: created.id, mode: 'persistent' });

        void sandboxStorageService
          .startInstanceBuild({ id: created.id, topicId })
          .catch(onBuildError)
          .finally(() => void refreshInstances());
      } catch (error) {
        onCreateError(error);
        void refreshInstances();
      } finally {
        preparing.remove(environmentId);
      }
    },
    [onBuildError, onChange, preparing.add, preparing.remove, refreshInstances, topicId],
  );

  return { create, isPreparing: preparing.has };
};
