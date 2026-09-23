import type { EnvironmentVisibility } from '@lobechat/types';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import {
  type SandboxEnvironmentSpecification,
  sandboxWorkspaceService,
} from '@/services/sandboxWorkspace';

const ENVIRONMENTS_KEY = 'sandbox-environments';
const INSTANCES_KEY = 'sandbox-environment-instances';
const WORKSPACE_KEY = 'sandbox-workspace-info';
const BUILD_KEY = 'sandbox-instance-build';

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
 * Working copies, in two phases.
 *
 * The rows themselves come from the database and settle in a few milliseconds.
 * Their sizes come from the execution plane, which needs a live sandbox session
 * to answer — seconds on a cold start, every time, and it can fail on its own.
 * Fetched together, the whole list waited on the slow half; so the rows are
 * asked for first and the sizes catch up in a second request that never blocks
 * them. While the sizes are still on their way `snapshotsPending` is true and a
 * row shows neither a size nor "unused", since it does not know yet; when the
 * store cannot be reached the rows still list with `snapshotsUnavailable` set.
 */
export const useInstances = () => {
  const rows = useClientDataSWR<Awaited<ReturnType<typeof sandboxWorkspaceService.listInstances>>>(
    [INSTANCES_KEY, 'rows'],
    () => sandboxWorkspaceService.listInstances({ withSizes: false }),
  );
  const sizes = useClientDataSWR<Awaited<ReturnType<typeof sandboxWorkspaceService.listInstances>>>(
    rows.data ? [INSTANCES_KEY, 'sizes'] : null,
    () => sandboxWorkspaceService.listInstances(),
    // A size does not change while the user looks at the page, and each
    // refetch is a sandbox round trip; refocusing the tab must not pay it.
    { dedupingInterval: 30_000, revalidateOnFocus: false },
  );

  const data = useMemo(() => {
    if (!rows.data) return undefined;
    const byId = new Map(sizes.data?.instances.map((instance) => [instance.id, instance.snapshot]));
    return {
      instances: rows.data.instances.map((instance) => ({
        ...instance,
        snapshot: byId.get(instance.id) ?? null,
      })),
      snapshotsPending: !sizes.data && !sizes.error,
      snapshotsUnavailable: sizes.data ? sizes.data.snapshotsUnavailable : !!sizes.error,
    };
  }, [rows.data, sizes.data, sizes.error]);

  const mutate = useCallback(async () => {
    await rows.mutate();
    await sizes.mutate();
  }, [rows.mutate, sizes.mutate]);

  return { data, error: rows.error, isLoading: rows.isLoading, mutate };
};

/**
 * How much of the workspace's storage is used, and how much it has.
 *
 * Reads the stored figure rather than measuring: a page load must not walk the
 * volume, and — more to the point — must not stamp the workspace as active,
 * which is the signal a later idle sweep selects on. `refresh` is the
 * measurement, and it belongs on something the user clicked.
 *
 * The figure can be null on a workspace nothing has measured yet; that is a
 * state to render, not an error. So is the absence of a workspace entirely:
 * this is a paid feature, and an account without one simply has no meter.
 */
export const useWorkspaceUsage = () => {
  const swr = useClientDataSWR<Awaited<ReturnType<typeof sandboxWorkspaceService.getWorkspace>>>(
    [WORKSPACE_KEY],
    () => sandboxWorkspaceService.getWorkspace(),
    // The number moves when a session writes, not while someone reads the
    // page; refocusing the tab is not a reason to ask again.
    { revalidateOnFocus: false },
  );

  const refresh = useCallback(async () => {
    // Optimistically publish what the measurement returns, so the meter moves
    // with the click instead of after a second round trip.
    await swr.mutate(() => sandboxWorkspaceService.refreshWorkspaceUsage(), {
      revalidate: false,
    });
  }, [swr.mutate]);

  return { data: swr.data, error: swr.error, isLoading: swr.isLoading, refresh };
};

/**
 * A build in flight, followed until it settles.
 *
 * Polling rather than a subscription because the runtime has no way to call
 * back, and the poll is what moves the instance out of `pending` — so it has
 * to run while the panel is open, and stop the moment nothing is building.
 *
 * The log accumulates across polls: each reply carries only what was written
 * since the offset it was asked for, which is what keeps a minutes-long
 * install from resending megabytes on every tick.
 */
export const useInstanceBuild = (instanceId: string, active: boolean) => {
  const [log, setLog] = useState('');
  const offset = useRef(0);
  const { mutate: refreshInstances } = useInstances();

  const swr = useClientDataSWR<
    Awaited<ReturnType<typeof sandboxWorkspaceService.instanceBuildStatus>>
  >(
    active ? [BUILD_KEY, instanceId] : null,
    () =>
      sandboxWorkspaceService.instanceBuildStatus({ id: instanceId, logOffset: offset.current }),
    {
      onSuccess: (data) => {
        if (data.chunk) {
          setLog((previous) => previous + data.chunk);
          offset.current = data.logOffset;
        }
        // The row settled on the server during this very call, so the list is
        // now stale in the one way that matters: the instance still reads as
        // building.
        if (data.state !== 'running') void refreshInstances();
      },
      refreshInterval: (data) => (data?.state === 'running' ? 2000 : 0),
      revalidateOnFocus: false,
    },
  );

  return { log, state: swr.data?.state };
};

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
 * Mutations, each refreshing exactly the lists it can have changed.
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

    /**
     * Materialize an instance. Fired after the insert rather than inside it —
     * starting a build cold-starts a sandbox, and the dialog must not wait.
     *
     * Swallows its failure on purpose: the server has already written the
     * reason onto the row, and the list is where a person looks for it. A
     * toast over a dialog that is already closing would say the same thing
     * somewhere it cannot be read twice.
     */
    buildInstance: async (id: string) => {
      try {
        await sandboxWorkspaceService.startInstanceBuild({ id });
      } catch {
        /* recorded on the instance; the list shows it */
      }
      await refreshInstances();
    },

    createInstance: async (params: {
      environmentId: string;
      name: string;
      workingDirectory: string;
    }) => {
      const created = await sandboxWorkspaceService.createInstance(params);
      await refreshInstances();
      return {
        // No build has been asked for yet — `buildInstance` is the next call
        // — so the row starts where the server starts it.
        buildError: null,
        buildId: null,
        createdAt: created.createdAt,
        environmentId: created.environmentId,
        id: created.id,
        // A folder that did not exist a moment ago is held by nobody, and has
        // nothing in it to report a size for.
        inUse: false,
        inUseByThisTopic: false,
        name: created.name,
        snapshot: null,
        status: 'pending',
        workingDirectory: created.workingDirectory,
      } satisfies SandboxInstance;
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
      // Existing instances are untouched by a specification edit, so only the
      // environment list has anything new to show.
      await refreshEnvironments();
    },
  };
};
