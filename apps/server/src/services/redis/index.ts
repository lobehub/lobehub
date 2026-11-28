import { agentAvailability } from './agentAvailability';
import { agentDocumentIndex } from './agentDocumentIndex';
import { agentIdentity } from './agentIdentity';
import { agentRunSlots } from './agentRunSlots';
import { agentSignal } from './agentSignal';
import { agentToolResults } from './agentToolResults';
import { botDeferred } from './botDeferred';
import { botReply } from './botReply';
import { botWake } from './botWake';
import { channelWatch } from './channelWatch';
import { connectorOAuth } from './connectorOAuth';
import { contextReplay } from './contextReplay';
import { deviceSystemInfo } from './deviceSystemInfo';
import { gitHubRefs } from './gitHubRefs';
import { heteroControl } from './heteroControl';
import { inboundWebhook } from './inboundWebhook';
import { linear } from './linear';
import { mcpDeviceRelay } from './mcpDeviceRelay';
import { openapi } from './openapi';
import { pageCollab } from './pageCollab';
import { qqPassive } from './qqPassive';
import { skillIndex } from './skillIndex';
import { skillTools } from './skillTools';
import { steerQueue } from './steerQueue';
import { taskRunDelivery } from './taskRunDelivery';
import { threadStartFence } from './threadStartFence';
import { workspaceRescan } from './workspaceRescan';

/** Business Redis API. Providers, keys and expiry policy stay inside each domain. */
export const redisService = {
  agentAvailability,
  agentDocumentIndex,
  agentIdentity,
  agentRunSlots,
  agentToolResults,
  agentSignal,
  botDeferred,
  botReply,
  botWake,
  channelWatch,
  connectorOAuth,
  contextReplay,
  deviceSystemInfo,
  gitHubRefs,
  heteroControl,
  inboundWebhook,
  linear,
  mcpDeviceRelay,
  openapi,
  pageCollab,
  qqPassive,
  skillIndex,
  skillTools,
  steerQueue,
  taskRunDelivery,
  threadStartFence,
  workspaceRescan,
};
