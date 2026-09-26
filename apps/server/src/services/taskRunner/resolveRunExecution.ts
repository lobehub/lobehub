import type { ChatTopicMetadata, TaskExecutionConfig, WorkingDirConfig } from '@lobechat/types';

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

/** The execution axes a topic carries, in the shape the readers expect. */
const topicExecutionOf = (metadata?: ChatTopicMetadata | null): string =>
  JSON.stringify({
    boundDeviceId: metadata?.boundDeviceId ?? null,
    repos: metadata?.repos ?? null,
    workingDirectory: metadata?.workingDirectory ?? null,
    workingDirectoryConfig: metadata?.workingDirectoryConfig ?? null,
  });

/**
 * The execution metadata a CONTINUED topic has to carry before this run.
 *
 * A topic's own values outrank everything a later run brings: `turnSetup` stamps
 * `initialTopicMetadata` only when it CREATES the topic, `heteroDispatch`'s cwd
 * resolver reads `topic.metadata.workingDirectory` above the run's initial
 * metadata (and above the agent's per-device pick and the device default), and
 * `topic.metadata.boundDeviceId` is what project grouping and the client's
 * worktree probes read. So a task retargeted since its topic was written would
 * continue on the machine it now pins with the PREVIOUS machine's directory —
 * a path that may not exist there — while the UI kept filing the topic under the
 * old machine.
 *
 * The task's own selection is the one statement that covers EVERY run of it, so
 * mirror it onto the topic before dispatching. Axes the task does not pin are
 * CLEARED, because "inherit the agent" is a decision too: a pin the user removed
 * must stop deciding where the run goes.
 *
 * Returns `undefined` when the topic already agrees — the common case, and a
 * continuation should not pay for a write it does not need.
 */
export const resolveTopicExecutionPatch = (
  topicMetadata: ChatTopicMetadata | null | undefined,
  execution?: TaskExecutionConfig,
): ChatTopicMetadata | undefined => {
  const initial = resolveTaskRunExecution(execution)?.initialTopicMetadata;

  const next: ChatTopicMetadata = {
    // `undefined` clears the axis: `TopicModel.updateMetadata` shallow-merges, so
    // the key is dropped rather than kept at its previous value.
    boundDeviceId: execution?.boundDeviceId,
    repos: initial?.repos,
    workingDirectory: initial?.workingDirectory,
    workingDirectoryConfig: initial?.workingDirectoryConfig,
  };

  return topicExecutionOf(topicMetadata) === topicExecutionOf(next) ? undefined : next;
};
