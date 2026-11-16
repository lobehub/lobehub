import { lambdaClient } from '@/libs/trpc/client';

/**
 * Renderer-side data layer for inbound webhooks — the automations that run an
 * agent without the user present. v1 has one kind, MCP event subscriptions,
 * which agents create in conversation; the client only lists, checks and
 * deletes them. Personal or workspace scope comes from the active workspace
 * the TRPC client already sends.
 */
class InboundWebhookService {
  /** Everything in the active scope, or one agent's automations. */
  list = async (agentId?: string) =>
    lambdaClient.inboundWebhook.list.query(agentId ? { agentId } : undefined);

  /**
   * Asks the source server whether the subscription still delivers, resuming
   * paused delivery as a side effect. Returns the refreshed row; a problem the
   * check found comes back as the row's status, not as a thrown error.
   */
  check = async (id: string) => lambdaClient.inboundWebhook.check.mutate({ id });

  delete = async (id: string) => lambdaClient.inboundWebhook.delete.mutate({ id });
}

export const inboundWebhookService = new InboundWebhookService();
