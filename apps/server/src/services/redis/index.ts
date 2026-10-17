import { agentIdentity } from './agentIdentity';
import { agentSignal } from './agentSignal';
import { deviceSystemInfo } from './deviceSystemInfo';
import { skillTools } from './skillTools';
import { workspaceRescan } from './workspaceRescan';

/** Business Redis API. Providers, keys and expiry policy stay inside each domain. */
export const redisService = {
  agentIdentity,
  agentSignal,
  deviceSystemInfo,
  skillTools,
  workspaceRescan,
};
