import type { TaskExecutionConfig, WorkingDirConfig } from '@lobechat/types';

/**
 * What a task's own execution selection contributes to ONE run.
 *
 * Kept separate from {@link TaskExecutionConfig} because the two answer
 * different questions: the stored config says what the user picked, this says
 * what the run should be told. Only the latter has to know that the device
 * rides as `deviceId` and the directory as `initialTopicMetadata`.
 */
export interface TaskRunExecution {
  /** `ExecAgentParams.deviceId` — pins the run's execution plan to this machine. */
  deviceId?: string;
  /** Stamped onto the topic this run creates; see `ExecAgentAppContext`. */
  initialTopicMetadata?: {
    repos?: string[];
    workingDirectory?: string;
    workingDirectoryConfig?: WorkingDirConfig;
  };
}

/**
 * Map a task's stored execution selection onto run parameters.
 *
 * Returns `undefined` when the task pins nothing, so callers spread it away and
 * the run keeps the assignee agent's own target and cwd — the behaviour every
 * task had before a task could carry a selection. Never returns an empty
 * `initialTopicMetadata`: an empty object would still count as "client-supplied
 * metadata" at the topic-creation site and change how the topic row is built.
 */
export const resolveTaskRunExecution = (
  execution?: TaskExecutionConfig,
): TaskRunExecution | undefined => {
  if (!execution) return undefined;

  const { boundDeviceId, repos, workingDirectory, workingDirectoryConfig } = execution;

  // Directory precedence: an explicit config, then an explicit path, then the
  // primary repo. The last step mirrors the chat gateway, which also treats a
  // repo selection as the run's directory (as a github repo) so a task that
  // only picked repos still starts somewhere — the cloud repo surface has no
  // absolute path to offer.
  const directoryConfig: WorkingDirConfig | undefined =
    workingDirectoryConfig ??
    (workingDirectory
      ? { path: workingDirectory }
      : repos && repos.length > 0
        ? { path: repos[0], repoType: 'github' }
        : undefined);

  const initialTopicMetadata = {
    ...(repos && repos.length > 0 ? { repos } : {}),
    ...(directoryConfig
      ? { workingDirectory: directoryConfig.path, workingDirectoryConfig: directoryConfig }
      : {}),
  };

  const runExecution: TaskRunExecution = {
    ...(boundDeviceId ? { deviceId: boundDeviceId } : {}),
    ...(Object.keys(initialTopicMetadata).length > 0 ? { initialTopicMetadata } : {}),
  };

  return Object.keys(runExecution).length > 0 ? runExecution : undefined;
};
