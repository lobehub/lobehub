import useSWR from 'swr';

import {
  type SandboxEnvironmentSpecification,
  sandboxWorkspaceService,
} from '@/services/sandboxWorkspace';

const ENVIRONMENTS_KEY = 'sandbox-environments';
const INSTANCES_KEY = 'sandbox-environment-instances';

/**
 * Specifications. Answered from the database alone, so this settles fast and is
 * safe to render the page on.
 */
export const useEnvironments = () =>
  useSWR(ENVIRONMENTS_KEY, () => sandboxWorkspaceService.listEnvironments());

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
  const { mutate: refreshEnvironments } = useEnvironments();
  const { mutate: refreshInstances } = useInstances();

  return {
    copyInstance: async (params: { id: string; name: string; workingDirectory: string }) => {
      await sandboxWorkspaceService.copyInstance(params);
      await refreshInstances();
    },

    createEnvironment: async (params: { description?: string; name: string }) => {
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
