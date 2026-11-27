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
 * agent fell back from a device of its own: it has no directory and never ran
 * on a machine, and the agent may use the sandbox (Claude Code, Codex). Such a
 * conversation was only left without a directory because the device could not
 * take it; the server routes its runs there too (`projectFallsBackToSandbox`).
 */
export const projectTopicFallsBackToSandbox = (
  agencyConfig: OwnDeviceConfig | undefined,
  topic:
    | {
        metadata?: { boundDeviceId?: string } | null;
        projectId?: string | null;
        projectWorkingDirectoryId?: string | null;
      }
    | undefined,
) =>
  !!topic?.projectId &&
  !topic.projectWorkingDirectoryId &&
  !topic.metadata?.boundDeviceId &&
  !!getAgentOwnDevice(agencyConfig)?.sandboxFallback;

/** Why an agent's own device cannot take a project conversation. */
export type OwnDeviceUnavailableReason = 'noDirectory' | 'offline';

export type OwnDeviceDirectoryResult<D> =
  { directory: D; kind: 'directory' } | { kind: 'unavailable'; reason: OwnDeviceUnavailableReason };

/**
 * The agent's own device's project directory a new conversation starts in: the
 * first of `directories` (in the project's order) on that device that can take
 * it now. Without one, why not — the device has no directory it may run in, or
 * it has one but cannot take the conversation now (offline, not ready).
 */
export const pickOwnDeviceDirectory = <D extends { deviceId?: string | null }>(
  directories: readonly D[],
  ownDevice: AgentOwnDevice,
  {
    isAvailable,
    isRunnable,
  }: { isAvailable: (directory: D) => boolean; isRunnable: (directory: D) => boolean },
): OwnDeviceDirectoryResult<D> => {
  const own = directories.filter(
    (directory) => directory.deviceId === ownDevice.deviceId && isRunnable(directory),
  );
  const directory = own.find(isAvailable);
  if (directory) return { directory, kind: 'directory' };
  return { kind: 'unavailable', reason: own.length > 0 ? 'offline' : 'noDirectory' };
};

/** The message key telling why Auto could not start on the agent's own device. */
export const ownDeviceNoticeKey = ({
  blocked,
  reason,
}: {
  blocked: boolean;
  reason: OwnDeviceUnavailableReason;
}) =>
  blocked
    ? reason === 'offline'
      ? ('runnerPicker.ownDevice.blocked_offline' as const)
      : ('runnerPicker.ownDevice.blocked_noDirectory' as const)
    : reason === 'offline'
      ? ('runnerPicker.ownDevice.fallback_offline' as const)
      : ('runnerPicker.ownDevice.fallback_noDirectory' as const);

/** Thrown when a device-only agent's own device cannot take a project conversation. */
export class OwnDeviceUnavailableError extends Error {
  reason: OwnDeviceUnavailableReason;
  constructor(reason: OwnDeviceUnavailableReason) {
    super(
      reason === 'offline'
        ? "The agent's device is offline"
        : "The agent's device has no directory in this project",
    );
    this.name = 'OwnDeviceUnavailableError';
    this.reason = reason;
  }
}
