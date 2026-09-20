import type { EnvironmentVisibility } from '@lobechat/types';
import useSWR, { useSWRConfig } from 'swr';

import {
  type SandboxEnvironmentSpecification,
  sandboxWorkspaceService,
} from '@/services/sandboxWorkspace';

const ENVIRONMENTS_KEY = 'sandbox-environments';
const INSTANCES_KEY = 'sandbox-environment-instances';

/**
 * Specifications. Answered from the database alone, so this settles fast and is
 * safe to render the page on.
 *
 * Keyed by pool, so the workspace page's two tabs do not overwrite each other's
 * cache — and so switching back to one shows what it held rather than a
 * skeleton. A mutation refreshes every pool, because publishing moves a row
 * from one to the other.
 */
export const useEnvironments = (visibility?: EnvironmentVisibility) =>
  useSWR([ENVIRONMENTS_KEY, visibility ?? 'all'], () =>
    sandboxWorkspaceService.listEnvironments(visibility ? { visibility } : undefined),
  );

/**
 * Working copies, joined with the state the execution plane holds for each.
 *
 * Reaching that state needs a live sandbox session, so this can take seconds on
 * a cold start — and can fail on its own, in which case the copies still list
 * with `snapshotsUnavailable` set and only their sizes are missing. Kept in its
 * own SWR entry for exactly that reason: a slow or broken snapshot store must
 * not hold up the list of what exists.
 */
export const useInstances = () =>
  useSWR(INSTANCES_KEY, () => sandboxWorkspaceService.listInstances());

export type SandboxInstance = NonNullable<
  ReturnType<typeof useInstances>['data']
>['instances'][number];

export type SandboxEnvironment = NonNullable<
  ReturnType<typeof useEnvironments>['data']
>['environments'][number];

/**
 * Mutations, each refreshing exactly the lists it can have changed. Editing a
 * specification touches the instance list too, because that is where staleness
 * is shown and every copy of an edited specification has just become stale.
 */
export const useEnvironmentActions = () => {
  const { mutate: globalMutate } = useSWRConfig();
  const { mutate: refreshInstances } = useInstances();

  // Every pool, not the one this caller happens to be looking at: publishing an
  // environment takes it out of one tab and puts it in the other, so refreshing
  // only the current key leaves the other tab showing a row that moved.
  const refreshEnvironments = () =>
    globalMutate((key) => Array.isArray(key) && key[0] === ENVIRONMENTS_KEY);

  return {
    copyInstance: async (params: { id: string; name: string; workingDirectory: string }) => {
      await sandboxWorkspaceService.copyInstance(params);
      await refreshInstances();
    },

    createEnvironment: async (params: {
      configuration?: SandboxEnvironmentSpecification;
      description?: string;
      name: string;
      visibility?: EnvironmentVisibility;
    }) => {
      await sandboxWorkspaceService.createEnvironment(params);
      await refreshEnvironments();
    },

    createInstance: async (params: {
      environmentId: string;
      name: string;
      workingDirectory: string;
    }) => {
      await sandboxWorkspaceService.createInstance(params);
      await refreshInstances();
    },

    setEnvironmentVisibility: async (params: { id: string; visibility: EnvironmentVisibility }) => {
      await sandboxWorkspaceService.setEnvironmentVisibility(params);
      await refreshEnvironments();
    },

    removeEnvironment: async (id: string) => {
      await sandboxWorkspaceService.removeEnvironment({ id });
      await refreshEnvironments();
    },

    removeInstance: async (id: string) => {
      await sandboxWorkspaceService.removeInstance({ id });
      await refreshInstances();
    },

    renameInstance: async (params: { id: string; name: string }) => {
      await sandboxWorkspaceService.renameInstance(params);
      await refreshInstances();
    },

    updateEnvironment: async (params: {
      configuration?: SandboxEnvironmentSpecification;
      description?: string;
      id: string;
      name?: string;
    }) => {
      await sandboxWorkspaceService.updateEnvironment(params);
      await Promise.all([refreshEnvironments(), refreshInstances()]);
    },
  };
};
