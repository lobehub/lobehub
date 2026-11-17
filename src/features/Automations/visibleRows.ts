import type { InboundWebhookItem } from '@lobechat/types';

/**
 * The rows a list shows. On an agent's page its custom webhooks have their own Webhook tab, so
 * the Automations tab lists only what the agent subscribed to; Settings → Automations lists all.
 */
export const visibleAutomations = (
  items: InboundWebhookItem[] | undefined,
  agentId?: string,
): InboundWebhookItem[] =>
  (items ?? []).filter((item) => !agentId || item.source.kind !== 'generic');
