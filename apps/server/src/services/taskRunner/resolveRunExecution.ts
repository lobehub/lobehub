import type {
  ChatTopicMetadata,
  LobeAgentAgencyConfig,
  TaskExecutionConfig,
  WorkingDirConfig,
} from '@lobechat/types';

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
 * The device a task's run will ACTUALLY use, once the assignee agent's own
 * target policy has had its say.
 *
 * A workspace author can fix the agent's execution target
 * (`executionTargetSelectionPolicy: 'fixed'`), and `turnSetup` then drops
 * whatever device the run asks for and routes to the agent's own target
 * instead (`effectiveRequestedDeviceId`, `topicBoundDeviceId`). This mirrors
 * that derivation, because the task side has to tell a pin the run will use
 * from one it will not — see `resolveTaskRunExecution`.
 *
 * `undefined` means the run does not land on a device at all (the sandbox).
 */
export const resolveRunDeviceId = (
  execution: TaskExecutionConfig | undefined,
  agencyConfig: LobeAgentAgencyConfig | null | undefined,
  workspaceId?: string,
): string | undefined => {
  const isFixedSelection =
    !!workspaceId && agencyConfig?.executionTargetSelectionPolicy === 'fixed';

  // A member-selected target is exactly the task-level pin, so nothing replaces it.
  if (!isFixedSelection) return execution?.boundDeviceId;

  // Only a `device` fixed target names a machine; a fixed sandbox names none.
  return agencyConfig?.executionTarget === 'device' ? agencyConfig.boundDeviceId : undefined;
};

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
  execution: TaskExecutionConfig | undefined,
  /**
   * The device this run will use — `resolveRunDeviceId`. Required, not optional:
   * it decides whether the directory may travel, and a caller that forgot it
   * would silently drop the directory of every pinned task.
   */
  runDeviceId: string | undefined,
): TaskRunExecution | undefined => {
  if (!execution) return undefined;

  const { boundDeviceId, repos, workingDirectory, workingDirectoryConfig } = execution;

  // Directory precedence: an explicit config, then an explicit path, then the
  // primary repo. The last step mirrors the chat gateway, which also treats a
  // repo selection as the run's directory (as a github repo) so a task that
  // only picked repos still starts somewhere — the cloud repo surface has no
  // absolute path to offer.
  const deviceDirectory =
    workingDirectoryConfig ?? (workingDirectory ? { path: workingDirectory } : undefined);

  // A directory is picked FOR a machine — `TaskWorkingDirectoryChip` offers the
  // run target's OWN directories — so it may only travel with that machine. When
  // the run does not land on the pinned device (a fixed agent target replaced
  // it, or the run goes to the sandbox), the path has to stay behind with the
  // pin. Nothing downstream can catch it: the topic carries the EFFECTIVE
  // device, so `resolveDeviceWorkingDirectoryConfig` sees matching run/topic
  // device ids and accepts another machine's absolute path as this one's.
  const isDeviceDirectoryUsable = !boundDeviceId || boundDeviceId === runDeviceId;

  const directoryConfig: WorkingDirConfig | undefined =
    (isDeviceDirectoryUsable ? deviceDirectory : undefined) ??
    (repos && repos.length > 0 ? { path: repos[0], repoType: 'github' } : undefined);

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
  execution: TaskExecutionConfig | undefined,
  /** The device this run will use — see {@link resolveTaskRunExecution}. */
  runDeviceId: string | undefined,
): ChatTopicMetadata | undefined => {
  const initial = resolveTaskRunExecution(execution, runDeviceId)?.initialTopicMetadata;

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
