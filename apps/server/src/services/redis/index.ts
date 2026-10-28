import { agentSignal } from './agentSignal';
import { botWake } from './botWake';
import { deviceSystemInfo } from './deviceSystemInfo';
import { linear } from './linear';
import { skillTools } from './skillTools';
import { steerQueue } from './steerQueue';
import { threadStartFence } from './threadStartFence';
import { workspaceRescan } from './workspaceRescan';

/** Business Redis API. Providers, keys and expiry policy stay inside each domain. */
export const redisService = {
  agentSignal,
  botWake,
  deviceSystemInfo,
  linear,
  skillTools,
  steerQueue,
  threadStartFence,
  workspaceRescan,
};
