import { isHeterogeneousSandboxExecutionAvailable } from './executionTarget';

/** The routing part of an `agencyConfig` (`LobeAgentAgencyConfig`). */
interface OwnDeviceConfig {
  boundDeviceId?: string;
  executionTarget?: string;
  executionTargetSelectionPolicy?: string;
  heterogeneousProvider?: { type?: string };
}

/** The device a heterogeneous agent runs on of its own. */
export interface AgentOwnDevice {
  deviceId: string;
  /**
   * Whether the agent may run in the cloud sandbox when its device cannot take
   * the conversation (Claude Code, Codex). A device-only provider, or an agent
   * its author fixed to the device, stays on it.
   */
  sandboxFallback: boolean;
}

/**
 * The device a heterogeneous agent (Claude Code, Codex, Cursor, …) is set to
 * run on: its `boundDeviceId`, while its target is that device. A project
 * conversation tries this device's project directory before the project's own
 * order. Not every agent: a regular agent defaults to `auto`, where a leftover
 * `boundDeviceId` is not a choice, and a hetero agent moved to the sandbox no
 * longer runs on its device.
 */
export const getAgentOwnDevice = (
  agencyConfig: OwnDeviceConfig | undefined,
): AgentOwnDevice | undefined => {
  const type = agencyConfig?.heterogeneousProvider?.type;
  const deviceId = agencyConfig?.boundDeviceId;
  if (!type || !deviceId) return;
  const target = agencyConfig.executionTarget;
  if (target !== undefined && target !== 'device' && target !== 'local') return;
  return {
    deviceId,
    sandboxFallback:
      isHeterogeneousSandboxExecutionAvailable(type) &&
      agencyConfig.executionTargetSelectionPolicy !== 'fixed',
  };
};

/**
 * Whether a started project conversation runs in the cloud sandbox because its
 * agent fell back from a device of its own (Claude Code, Codex): the server
 * marked it so on a run that found the device offline
 * (`metadata.projectSandboxFallback`), or it has no directory, never ran on a
 * machine, and the device is offline now — which is what that run will find.
 * While the device is online such a conversation runs there, in the agent's
 * own working directory. Mirrors the server's `withProjectSandboxFallback`.
 */
export const projectTopicFallsBackToSandbox = (
  agencyConfig: OwnDeviceConfig | undefined,
  topic:
    | {
        metadata?: { boundDeviceId?: string; projectSandboxFallback?: boolean } | null;
        projectId?: string | null;
        projectWorkingDirectoryId?: string | null;
      }
    | undefined,
  /** The own device's presence now; `undefined` while it is not known. */
  ownDeviceOnline: boolean | undefined,
) => {
  if (!topic?.projectId || topic.projectWorkingDirectoryId) return false;
  if (!getAgentOwnDevice(agencyConfig)?.sandboxFallback) return false;
  if (topic.metadata?.projectSandboxFallback) return true;
  return !topic.metadata?.boundDeviceId && ownDeviceOnline === false;
};

/** Why an agent's own device cannot take a project conversation. */
export type OwnDeviceUnavailableReason = 'offline';

export type OwnDeviceDirectoryResult<D> =
  | { directory: D; kind: 'directory' }
  | { kind: 'workingDirectory' }
  | { kind: 'unavailable'; reason: OwnDeviceUnavailableReason };

/**
 * Where on its own device a new project conversation of the agent starts: the
 * first of `directories` (in the project's order) on that device that can take
 * it now; else, while the device is online, the agent's own working directory
 * there (`workingDirByDevice`, or the device's default) — no project folder
 * has to be added first; else nowhere, the device being offline.
 */
export const pickOwnDeviceDirectory = <D extends { deviceId?: string | null }>(
  directories: readonly D[],
  ownDevice: AgentOwnDevice,
  {
    deviceOnline,
    isAvailable,
    isRunnable,
  }: {
    deviceOnline: boolean;
    isAvailable: (directory: D) => boolean;
    isRunnable: (directory: D) => boolean;
  },
): OwnDeviceDirectoryResult<D> => {
  const directory = directories.find(
    (item) => item.deviceId === ownDevice.deviceId && isRunnable(item) && isAvailable(item),
  );
  if (directory) return { directory, kind: 'directory' };
  if (deviceOnline) return { kind: 'workingDirectory' };
  return { kind: 'unavailable', reason: 'offline' };
};

/**
 * What Auto tells about the agent's own device: it runs in its own working
 * directory there, or the device is offline — so the conversation runs in the
 * sandbox, or (`blocked`) not at all.
 */
export type OwnDeviceNotice =
  | { blocked: boolean; reason: OwnDeviceUnavailableReason }
  | { deviceId: string; workingDirectory: true };

/** The message key of an {@link OwnDeviceNotice}. */
export const ownDeviceNoticeKey = (notice: OwnDeviceNotice) =>
  'workingDirectory' in notice
    ? ('runnerPicker.ownDevice.workingDirectory' as const)
    : notice.blocked
      ? ('runnerPicker.ownDevice.blocked_offline' as const)
      : ('runnerPicker.ownDevice.fallback_offline' as const);

/** Thrown when a device-only agent's own device cannot take a project conversation. */
export class OwnDeviceUnavailableError extends Error {
  reason: OwnDeviceUnavailableReason;
  constructor(reason: OwnDeviceUnavailableReason) {
    super("The agent's device is offline");
    this.name = 'OwnDeviceUnavailableError';
    this.reason = reason;
  }
}
