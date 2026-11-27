import {
  type AgentOwnDevice,
  type OwnDeviceUnavailableReason,
  pickOwnDeviceDirectory,
} from '@/helpers/agentOwnDevice';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

import {
  pickExecutionEnvironment,
  type ProjectExecutionEnvironment,
  SANDBOX_EXECUTION_ENVIRONMENT,
} from './executionEnvironmentOrder';

/** Where a new project conversation of one agent starts, and what that means for it. */
export interface ProjectRunnerChoice {
  /**
   * Nothing may take the conversation: a device-only agent whose own device
   * cannot. The draft sits on the project alone and the send is refused
   * (`resolveProjectDirectoryRun`) instead of running anywhere else.
   */
  blocked?: boolean;
  environment: ProjectExecutionEnvironment;
  /** The agent's own device could not take it automatically, and why. */
  ownDeviceUnavailable?: OwnDeviceUnavailableReason;
}

const SANDBOX: ProjectExecutionEnvironment = { id: SANDBOX_EXECUTION_ENVIRONMENT, kind: 'sandbox' };

/**
 * The runner a new project conversation of this agent starts on. A pick by
 * hand wins while the project still has it. Otherwise a heterogeneous agent
 * with a device of its own (`getAgentOwnDevice`) starts on that device's
 * project directory, outside the project's order; when the device cannot take
 * it, one that may use the sandbox starts there — never on another device's
 * directory — and a device-only one is `blocked`. Every other agent follows
 * the project's order: the first directory ready on an online device, or the
 * sandbox.
 *
 * Mirrors the send-time rule in `resolveProjectDirectoryRun`, so a draft is
 * never staged where the send would refuse or move it.
 */
export const resolveAgentProjectRunner = (
  ordered: readonly ProjectExecutionEnvironment[],
  pickedId: string | undefined,
  {
    isAvailable,
    isRunnable,
    ownDevice,
  }: {
    /** The directory can take a conversation of this agent now. */
    isAvailable: (directory: ProjectDirectory) => boolean;
    /** The agent may run in the directory at all (device online or not). */
    isRunnable: (directory: ProjectDirectory) => boolean;
    ownDevice: AgentOwnDevice | undefined;
  },
): ProjectRunnerChoice => {
  const picked = pickedId && ordered.find((environment) => environment.id === pickedId);
  if (picked) return { environment: picked };
  if (!ownDevice) return { environment: pickExecutionEnvironment(ordered, isAvailable) };

  const directories = ordered.flatMap((environment) =>
    environment.kind === 'directory' ? [environment.directory] : [],
  );
  // `runnable` as the send reads it (`resolveProjectDirectoryRun`), so both say the same reason.
  const own = pickOwnDeviceDirectory(directories, ownDevice, {
    isAvailable,
    isRunnable: (directory) => !!directory.runnable && isRunnable(directory),
  });
  if (own.kind === 'directory')
    return {
      environment: { directory: own.directory, id: own.directory.id, kind: 'directory' },
    };
  return {
    blocked: !ownDevice.sandboxFallback || undefined,
    environment: SANDBOX,
    ownDeviceUnavailable: own.reason,
  };
};
