import type { DeviceControlDeps } from '@lobechat/device-control';
import {
  checkAgentCredential,
  defaultAgentCredentialRootDir,
  installAgentCredential,
  removeAgentCredential,
} from '@lobechat/device-control/agent-credentials';

/**
 * Where provider credentials the server installed for heterogeneous agent runs
 * live: `~/.lobehub/agent-credentials/<provider>/`, owner access only. The
 * desktop app reads the same store, because a credential installed through one
 * client must apply to runs the other one spawns on the same machine.
 */
export const agentCredentialRootDir = () => defaultAgentCredentialRootDir();

/**
 * The device-control handlers that let the server manage those credentials,
 * plus the store root that file RPCs must never enter.
 */
export const createAgentCredentialDeps = (
  rootDir = agentCredentialRootDir(),
): Pick<
  DeviceControlDeps,
  | 'agentCredentialRootDir'
  | 'checkAgentCredential'
  | 'installAgentCredential'
  | 'removeAgentCredential'
> => ({
  agentCredentialRootDir: rootDir,
  checkAgentCredential: (params) => checkAgentCredential(params, { rootDir }),
  installAgentCredential: (params) => installAgentCredential(params, { rootDir }),
  removeAgentCredential: (params) => removeAgentCredential(params, { rootDir }),
});
