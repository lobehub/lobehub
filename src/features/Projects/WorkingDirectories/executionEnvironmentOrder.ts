import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

/** The id the cloud sandbox takes in a project's execution-environment order. */
export const SANDBOX_EXECUTION_ENVIRONMENT = 'sandbox';

/** One of a project's execution environments: the cloud sandbox, or a device folder. */
export type ProjectExecutionEnvironment =
  | { id: typeof SANDBOX_EXECUTION_ENVIRONMENT; kind: 'sandbox' }
  | { directory: ProjectDirectory; id: string; kind: 'directory' };

const SANDBOX_ENTRY: ProjectExecutionEnvironment = {
  id: SANDBOX_EXECUTION_ENVIRONMENT,
  kind: 'sandbox',
};

/**
 * A project's execution environments in priority order: by their stored place,
 * a folder before the sandbox on a tie — so a project nobody reordered tries
 * its folders first and falls back to the sandbox — and folders among
 * themselves in the order they came (the list's own order).
 */
export const orderExecutionEnvironments = (
  directories: readonly ProjectDirectory[],
  sandboxOrder = 0,
): ProjectExecutionEnvironment[] =>
  [
    ...directories.map((directory, index) => ({
      index,
      item: { directory, id: directory.id, kind: 'directory' } as ProjectExecutionEnvironment,
      sortOrder: directory.sortOrder ?? 0,
    })),
    {
      index: directories.length,
      item: SANDBOX_ENTRY,
      sortOrder: sandboxOrder,
    },
  ]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    .map(({ item }) => item);

/**
 * Where a new conversation starts: the first execution environment in the
 * order that can take it now — a folder on a device that is online and ready
 * — or the cloud sandbox, which always can. A folder after the sandbox is
 * never picked automatically; it is still there to choose by hand.
 */
export const pickExecutionEnvironment = (
  ordered: readonly ProjectExecutionEnvironment[],
  isAvailable: (directory: ProjectDirectory) => boolean,
): ProjectExecutionEnvironment => {
  for (const environment of ordered) {
    if (environment.kind === 'sandbox') return environment;
    if (isAvailable(environment.directory)) return environment;
  }
  return SANDBOX_ENTRY;
};
