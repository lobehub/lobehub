import { agentSignal } from './agentSignal';
import { agentToolResults } from './agentToolResults';
import { botWake } from './botWake';
import { deviceSystemInfo } from './deviceSystemInfo';
import { linear } from './linear';
import { pageCollab } from './pageCollab';
import { skillTools } from './skillTools';
import { steerQueue } from './steerQueue';
import { threadStartFence } from './threadStartFence';
import { workspaceRescan } from './workspaceRescan';

/** Business Redis API. Providers, keys and expiry policy stay inside each domain. */
export const redisService = {
  agentToolResults,
  agentSignal,
  botWake,
  deviceSystemInfo,
  linear,
  pageCollab,
  skillTools,
  steerQueue,
  threadStartFence,
  workspaceRescan,
};
