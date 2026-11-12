import type { EnvironmentVisibility } from '@lobechat/types';

import { sandboxActions, sandboxSelectors, useSandboxStore } from '@/store/sandbox';

export type { CreatedEnvironment, SandboxEnvironment } from '@/store/sandbox';

/**
 * Specifications, one pool at a time: `public` / `private` on the workspace
 * page's two tabs, every environment on the personal page.
 *
 * Read from the sandbox store's environments replica, which the composer's
 * picker shares, so a reload paints the last list from storage and the network
 * only confirms it. A restored row has no `configuration` (it carries `env`), so
 * `confirmed` says when the server has answered: until then an empty list or a
 * missing row is not an answer yet.
 *
 * Partitioned by the cache scope (user + workspace): a list fetched in one
 * workspace is never served in another.
 */
export const useEnvironments = (visibility?: EnvironmentVisibility) => {
  const sync = sandboxActions.useFetchEnvironments(visibility);
  const environments = useSandboxStore(sandboxSelectors.environments(visibility));
  const confirmed = useSandboxStore(sandboxSelectors.isEnvironmentsConfirmed(visibility));

  return { ...sync, confirmed, environments };
};

/**
 * Mutations, each landing on the replica as soon as the server agrees, then
 * refreshing every pool — publishing moves a row from one pool to the other.
 */
export const useEnvironmentActions = () => ({
  createEnvironment: sandboxActions.createEnvironment,
  removeEnvironment: sandboxActions.removeEnvironment,
  setEnvironmentVisibility: sandboxActions.setEnvironmentVisibility,
  updateEnvironment: sandboxActions.updateEnvironment,
});
