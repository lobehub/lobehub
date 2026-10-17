import { agentSignal } from './agentSignal';
import { deviceSystemInfo } from './deviceSystemInfo';
import { linear } from './linear';
import { skillTools } from './skillTools';
import { workspaceRescan } from './workspaceRescan';

/** Business Redis API. Providers, keys and expiry policy stay inside each domain. */
export const redisService = {
  agentSignal,
  deviceSystemInfo,
  linear,
  skillTools,
  workspaceRescan,
};
