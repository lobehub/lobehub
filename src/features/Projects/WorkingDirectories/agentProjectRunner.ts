import {
  type AgentOwnDevice,
  type OwnDeviceNotice,
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
  /**
   * Where it starts. On the agent's own working directory it is the project
   * alone (`sandbox`, the conversation-only place): the folder is not one of
   * the project's, and the run takes the agent's own device and cwd.
   */
  environment: ProjectExecutionEnvironment;
  /** What to tell about the agent's own device, when it is not one of its project folders. */
  notice?: OwnDeviceNotice;
  /** It runs on the agent's own device, in its own working directory there. */
  ownWorkingDirectory?: boolean;
}

const SANDBOX: ProjectExecutionEnvironment = { id: SANDBOX_EXECUTION_ENVIRONMENT, kind: 'sandbox' };

/**
 * The runner a new project conversation of this agent starts on. A pick by
 * hand wins while the project still has it. Otherwise a heterogeneous agent
 * with a device of its own (`getAgentOwnDevice`) starts on that device's
 * project directory, outside the project's order — or, with no such folder,
 * in its own working directory there; when the device is offline, one that may
 * use the sandbox starts there — never on another device's directory — and a
 * device-only one is `blocked`. Every other agent follows
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
    isDeviceOnline,
    isRunnable,
    ownDevice,
  }: {
    /** The directory can take a conversation of this agent now. */
    isAvailable: (directory: ProjectDirectory) => boolean;
    /** The device is confirmed online now. */
    isDeviceOnline: (deviceId: string) => boolean;
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
    deviceOnline: isDeviceOnline(ownDevice.deviceId),
    isAvailable,
    isRunnable: (directory) => !!directory.runnable && isRunnable(directory),
  });
  if (own.kind === 'directory')
    return {
      environment: { directory: own.directory, id: own.directory.id, kind: 'directory' },
    };
  if (own.kind === 'workingDirectory')
    return {
      environment: SANDBOX,
      notice: { deviceId: ownDevice.deviceId, workingDirectory: true },
      ownWorkingDirectory: true,
    };
  const blocked = !ownDevice.sandboxFallback;
  return {
    blocked: blocked || undefined,
    environment: SANDBOX,
    notice: { blocked, reason: own.reason },
  };
};
