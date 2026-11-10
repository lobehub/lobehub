import type { EnvironmentVisibility } from '@lobechat/types';
import { useSWRConfig } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import {
  environmentService,
  type NewEnvironmentSpecification,
  type SandboxEnvironmentSpecification,
} from '@/services/environment';

const ENVIRONMENTS_KEY = 'sandbox-environments';

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
  useClientDataSWR<Awaited<ReturnType<typeof environmentService.listEnvironments>>>(
    [ENVIRONMENTS_KEY, visibility ?? 'all'],
    () => environmentService.listEnvironments(visibility ? { visibility } : undefined),
  );

/** A new environment as `createEnvironment` returns it: the definition alone. */
export type CreatedEnvironment = Awaited<ReturnType<typeof environmentService.createEnvironment>>;

export type SandboxEnvironment = NonNullable<
  ReturnType<typeof useEnvironments>['data']
>['environments'][number];

/**
 * Mutations, each refreshing exactly the lists it can have changed.
 */
export const useEnvironmentActions = () => {
  const { mutate: globalMutate } = useSWRConfig();

  // Every pool and every workspace, not the one this caller happens to be
  // looking at: publishing an environment takes it out of one tab and puts it
  // in the other, so refreshing only the current key leaves the other tab
  // showing a row that moved. The workspace id the key carries is part of what
  // is matched loosely here, for the same reason.
  const refreshEnvironments = () =>
    globalMutate((key) => Array.isArray(key) && key[0] === ENVIRONMENTS_KEY);

  return {
    createEnvironment: async (params: {
      configuration?: NewEnvironmentSpecification;
      description?: string;
      name: string;
      visibility?: EnvironmentVisibility;
    }) => {
      // Returned, not discarded: the caller opens the environment it made.
      // Nothing is built — a conversation applies it to its working directory.
      const created = await environmentService.createEnvironment(params);
      await refreshEnvironments();

      return created;
    },

    setEnvironmentVisibility: async (params: { id: string; visibility: EnvironmentVisibility }) => {
      await environmentService.setEnvironmentVisibility(params);
      await refreshEnvironments();
    },

    removeEnvironment: async (id: string) => {
      await environmentService.removeEnvironment({ id });
      await refreshEnvironments();
    },

    updateEnvironment: async (params: {
      configuration?: SandboxEnvironmentSpecification;
      description?: string;
      id: string;
      name?: string;
    }) => {
      await environmentService.updateEnvironment(params);
      await refreshEnvironments();
    },
  };
};
