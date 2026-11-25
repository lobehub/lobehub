import os from 'node:os';
import path from 'node:path';

import type { DeviceControlDeps } from '@lobechat/device-control';
import {
  checkAgentCredential,
  installAgentCredential,
  removeAgentCredential,
} from '@lobechat/device-control/agent-credentials';

import { CLI_CONFIG_DIR_NAME } from '../constants/identity';

/**
 * Where `lh connect` keeps provider credentials the server installed for
 * heterogeneous agent runs: `~/.lobehub/agent-credentials/<provider>/`, owner
 * access only.
 */
export const agentCredentialRootDir = () =>
  path.join(os.homedir(), CLI_CONFIG_DIR_NAME, 'agent-credentials');

/** The device-control handlers that let the server manage those credentials. */
export const createAgentCredentialDeps = (
  rootDir = agentCredentialRootDir(),
): Pick<
  DeviceControlDeps,
  'checkAgentCredential' | 'installAgentCredential' | 'removeAgentCredential'
> => ({
  checkAgentCredential: (params) => checkAgentCredential(params, { rootDir }),
  installAgentCredential: (params) => installAgentCredential(params, { rootDir }),
  removeAgentCredential: (params) => removeAgentCredential(params, { rootDir }),
});
