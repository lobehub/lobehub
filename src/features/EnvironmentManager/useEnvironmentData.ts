import type { EnvironmentVisibility } from '@lobechat/types';
import { useSWRConfig } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
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
 *
 * `useClientDataSWR` rather than plain SWR, because it adds the active
 * workspace to the key. Without that dimension a list fetched in one workspace
 * keeps being served after switching to another — the same trap the device list
 * documents, and a worse one here, where the answer is which environments exist
 * for whom.
 */
export const useEnvironments = (visibility?: EnvironmentVisibility) =>
  useClientDataSWR<Awaited<ReturnType<typeof sandboxWorkspaceService.listEnvironments>>>(
    [ENVIRONMENTS_KEY, visibility ?? 'all'],
    () => sandboxWorkspaceService.listEnvironments(visibility ? { visibility } : undefined),
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
  useClientDataSWR<Awaited<ReturnType<typeof sandboxWorkspaceService.listInstances>>>(
    [INSTANCES_KEY],
    () => sandboxWorkspaceService.listInstances(),
  );

const SESSIONS_KEY = 'sandbox-environment-sessions';

/**
 * One environment's run history. Keyed by environment so opening another
 * panel fetches its own rather than serving the previous one's rows.
 */
export const useInstanceSessions = (environmentId: string) =>
  useClientDataSWR<Awaited<ReturnType<typeof sandboxWorkspaceService.listInstanceSessions>>>(
    [SESSIONS_KEY, environmentId],
    () => sandboxWorkspaceService.listInstanceSessions({ environmentId }),
    {
      // A run that is still going changes on its own — it ends, or a snapshot
      // lands — so the panel keeps looking while one is on screen and stops
      // the moment none is.
      refreshInterval: (data) => (data?.sessions.some((session) => !session.endedAt) ? 15_000 : 0),
    },
  );

export type SandboxSessionRecord = NonNullable<
  ReturnType<typeof useInstanceSessions>['data']
>['sessions'][number];

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

  // Every pool and every workspace, not the one this caller happens to be
  // looking at: publishing an environment takes it out of one tab and puts it
  // in the other, so refreshing only the current key leaves the other tab
  // showing a row that moved. The workspace id the key carries is part of what
  // is matched loosely here, for the same reason.
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
      // The environment list first, and only then the instance list — in that
      // order, and not together. The instance list is what shows staleness,
      // so it has to be refreshed, but fetching it with sizes pays a sandbox
      // cold start of several seconds; and issued in the same tick the two
      // calls land in one tRPC batch request, so "not awaited" still meant
      // the save spinner waited for it. Kicked off after the fast one has
      // returned, it travels alone and the tags catch up when it lands.
      await refreshEnvironments();
      void refreshInstances();
    },
  };
};
