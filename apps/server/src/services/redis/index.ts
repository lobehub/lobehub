import { agentDocumentIndex } from './agentDocumentIndex';
import { agentIdentity } from './agentIdentity';
import { agentRunSlots } from './agentRunSlots';
import { agentSignal } from './agentSignal';
import { botDeferred } from './botDeferred';
import { botReply } from './botReply';
import { botWake } from './botWake';
import { connectorOAuth } from './connectorOAuth';
import { deviceSystemInfo } from './deviceSystemInfo';
import { heteroControl } from './heteroControl';
import { inboundWebhook } from './inboundWebhook';
import { linear } from './linear';
import { openapi } from './openapi';
import { pageCollab } from './pageCollab';
import { qqPassive } from './qqPassive';
import { skillTools } from './skillTools';
import { steerQueue } from './steerQueue';
import { taskRunDelivery } from './taskRunDelivery';
import { threadStartFence } from './threadStartFence';
import { workspaceRescan } from './workspaceRescan';

/** Business Redis API. Providers, keys and expiry policy stay inside each domain. */
export const redisService = {
  agentDocumentIndex,
  agentIdentity,
  agentRunSlots,
  agentSignal,
  botDeferred,
  botReply,
  botWake,
  connectorOAuth,
  deviceSystemInfo,
  heteroControl,
  inboundWebhook,
  linear,
  openapi,
  pageCollab,
  qqPassive,
  skillTools,
  steerQueue,
  taskRunDelivery,
  threadStartFence,
  workspaceRescan,
};
