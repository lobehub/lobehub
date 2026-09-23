import type { WorkingDirConfig, WorkingDirRepoType } from '../device';

/**
 * Where a Task's runs execute — the machine and the working directory/repo set
 * it is anchored to. Persisted under `tasks.config.execution`.
 *
 * A Task is long-lived and runs more than once (manual / schedule / heartbeat),
 * so this selection cannot live on a topic (one per run) or in client state
 * (unreadable from a scheduled tick) the way the chat composer's equivalent
 * does. Stored on the task row, it is read by `TaskRunnerService.runTask` and
 * handed to the run itself.
 *
 * Absent fields mean INHERIT, not "unset": a task with no `execution` block
 * behaves exactly as tasks did before this existed — the assignee agent's own
 * execution target and working directory decide. Clearing a field returns that
 * axis to inheritance; it never means "run nowhere".
 *
 * Only the device axis is expressed as a pin. The run contract routes a device
 * by id (`requestedDeviceId` forces device routing unless the agent's policy is
 * `fixed`), and deliberately has no way to force the cloud sandbox, so a task
 * can pin a machine but cannot override an agent's stored target to `sandbox`.
 */
export interface TaskExecutionConfig {
  /**
   * Device every run is pinned to. Absent → the assignee agent's own
   * `agencyConfig` (execution target + bound device) decides. Ignored when the
   * agent's `executionTargetSelectionPolicy` is `fixed` — an author-controlled
   * target is not overridable, the same rule the chat picker follows.
   */
  boundDeviceId?: string;
  /**
   * Repos pre-selected for every run's topic. Feeds the agent's repo-aware
   * surfaces; meaningful for cloud / heterogeneous agents whose available repos
   * come from the agent's provider env.
   */
  repos?: string[];
  /** Primary working directory every run starts in (device-bound runs). */
  workingDirectory?: string;
  /** Path + repo type written alongside {@link workingDirectory}. */
  workingDirectoryConfig?: WorkingDirConfig;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Read the execution selection out of a free-form task config.
 *
 * `tasks.config` is untyped jsonb written by several callers across releases,
 * so this validates every field instead of trusting the shape — a malformed
 * entry must degrade to "inherit", never to a broken run.
 */
export const readTaskExecutionConfig = (
  config: null | Record<string, unknown> | undefined,
): TaskExecutionConfig | undefined => {
  const raw = config?.execution;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const { boundDeviceId, repos, workingDirectory, workingDirectoryConfig } = raw as Record<
    string,
    unknown
  >;

  const execution: TaskExecutionConfig = {};

  if (isNonEmptyString(boundDeviceId)) execution.boundDeviceId = boundDeviceId;

  if (Array.isArray(repos)) {
    const validRepos = repos.filter(isNonEmptyString);
    if (validRepos.length > 0) execution.repos = validRepos;
  }

  if (isNonEmptyString(workingDirectory)) execution.workingDirectory = workingDirectory;

  if (workingDirectoryConfig && typeof workingDirectoryConfig === 'object') {
    const { path, repoType } = workingDirectoryConfig as Record<string, unknown>;
    if (isNonEmptyString(path)) {
      execution.workingDirectoryConfig = {
        path,
        ...(isNonEmptyString(repoType) && { repoType: repoType as WorkingDirRepoType }),
      };
    }
  }

  return Object.keys(execution).length > 0 ? execution : undefined;
};

/**
 * Whether this task pins anything of its own, i.e. does not purely inherit.
 *
 * Checks the values, not the key count: callers build the next selection by
 * spreading the previous one (`{ ...value, boundDeviceId: undefined }` to
 * unpin), so an object with every axis present but empty is the normal shape of
 * "nothing selected" and must not be persisted as a selection.
 */
export const hasTaskExecutionSelection = (execution?: TaskExecutionConfig): boolean =>
  !!execution &&
  (!!execution.boundDeviceId ||
    !!execution.workingDirectory ||
    !!execution.workingDirectoryConfig ||
    (execution.repos?.length ?? 0) > 0);

/**
 * Apply a repo selection to an execution selection, keeping the working
 * directory in step.
 *
 * A repo selection IS the run's directory on the cloud surface, written exactly
 * the way the chat composer writes it when the first message creates the topic
 * (`workingDirectory` + a `github` config). Shared by every surface that offers
 * the repo picker so a task set up from the task list and one set up from the
 * task detail cannot end up with different stored shapes.
 */
export const applyTaskReposSelection = (
  execution: TaskExecutionConfig | undefined,
  repos?: string[],
): TaskExecutionConfig => ({
  ...execution,
  repos,
  workingDirectory: repos?.[0],
  workingDirectoryConfig: repos?.[0] ? { path: repos[0], repoType: 'github' } : undefined,
});

/**
 * Point the directory axis at an explicit directory on the run's machine.
 *
 * The device surface's counterpart of {@link applyTaskReposSelection}: there the
 * directory is an absolute path on the device, so a repo selection is dropped —
 * a repo identifier means nothing to a run that is not in the cloud sandbox.
 */
export const applyTaskDirectorySelection = (
  execution: TaskExecutionConfig | undefined,
  config?: WorkingDirConfig,
): TaskExecutionConfig => ({
  ...execution,
  repos: undefined,
  workingDirectory: config?.path,
  workingDirectoryConfig: config,
});

/**
 * Drop the cloud-repo axis, keeping a machine-local selection.
 *
 * A repo identifier is resolved by the assignee agent's provider env, so it
 * belongs to the agent it was chosen for — the same identifier can be
 * unavailable to another agent and leave the run with a directory it cannot
 * open. Both assignee-change paths use this: picking another agent while
 * creating a task, and reassigning an existing one (there the server applies it
 * inside the write that moves the assignee, see `TaskModel.updateWithLog`).
 *
 * A device pin and a path on a machine are the user's own, so they survive the
 * change — only the repo's own directory (written by
 * {@link applyTaskReposSelection}) is dropped with it.
 *
 * Returns the SAME reference when there is nothing to drop, so callers can tell
 * "nothing to do" without comparing fields.
 */
export const clearTaskReposSelection = (
  execution?: TaskExecutionConfig,
): TaskExecutionConfig | undefined =>
  execution?.repos
    ? {
        ...execution,
        repos: undefined,
        workingDirectory: undefined,
        workingDirectoryConfig: undefined,
      }
    : execution;

/**
 * Drop the directory axis entirely.
 *
 * Used when the run's TARGET changes, because the two axes describe the same
 * thing in different units: `lobehub/lobehub` is a cloud repo, `/srv/app` is a
 * directory on one machine. Carrying either one across a target change would
 * leave a selection that silently describes a machine the run is no longer on.
 */
export const clearTaskDirectorySelection = (
  execution: TaskExecutionConfig | undefined,
): TaskExecutionConfig => ({
  ...execution,
  repos: undefined,
  workingDirectory: undefined,
  workingDirectoryConfig: undefined,
});

/**
 * The persisted shape of an execution selection.
 *
 * Every axis is written explicitly and a cleared axis becomes `null`, because
 * the task config is updated by a DEEP MERGE (`TaskModel.updateTaskConfig`):
 * a key left out of the patch keeps its previous value, so an omitted axis
 * would leave the old device/directory in place and the control would look
 * like it did nothing. `null` is the "inherit" value the reader already
 * ignores. Writers must go through this — `config` set via `task.update`
 * replaces the whole column instead, taking model / brief / review /
 * checkpoint with it.
 */
export const toTaskExecutionConfigPatch = (
  execution?: TaskExecutionConfig,
): Record<string, unknown> => ({
  boundDeviceId: execution?.boundDeviceId ?? null,
  repos: execution?.repos ?? null,
  workingDirectory: execution?.workingDirectory ?? null,
  workingDirectoryConfig: execution?.workingDirectoryConfig ?? null,
});
