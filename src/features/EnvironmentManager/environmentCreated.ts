import type { CreatedEnvironment } from './useEnvironmentData';

/**
 * Straight after an environment is created: open it, and start its default
 * copy, which the server made in the same call. Nothing is asked — the person
 * has not started any work yet, so a name and a folder would be answers made
 * up on the spot; both are derived, and renaming is on the copy's row.
 *
 * A code environment clones and installs, so this is where that build starts,
 * after the dialog has closed. A files environment has nothing to build: the
 * same call is settled as ready on the server without starting a sandbox, so
 * the copy never sits in a "pending" state waiting on a build that will not
 * come.
 */
export const openCreatedEnvironment = (
  created: Pick<CreatedEnvironment, 'defaultInstance' | 'id'>,
  {
    buildInstance,
    select,
  }: { buildInstance: (instanceId: string) => Promise<void>; select: (id: string) => void },
) => {
  select(created.id);
  void buildInstance(created.defaultInstance.id);
};
