import { handleMcpEventDelivery } from './mcpEvents/delivery';
import { maintainMcpSubscription, teardownMcpSubscription } from './mcpEvents/subscription';
import { buildMcpEventPrompt } from './mcpEvents/wakePrompt';
import type { InboundWebhookKindHandler } from './types';

const kinds: Record<string, InboundWebhookKindHandler> = {
  mcp_events: {
    buildPrompt: buildMcpEventPrompt,
    handleDelivery: handleMcpEventDelivery,
    maintain: maintainMcpSubscription,
    teardown: teardownMcpSubscription,
  },
};
export const getInboundWebhookKind = (kind: string): InboundWebhookKindHandler | undefined =>
  kinds[kind];
export type { InboundWebhookContext, InboundWebhookKindHandler } from './types';
