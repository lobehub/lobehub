import type { GenericWebhookTopicMode } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface GenericWebhookSettings {
  autoApprove?: boolean;
  instructions?: string | null;
  name?: string | null;
  topicMode?: GenericWebhookTopicMode;
}

/**
 * Renderer-side data layer for inbound webhooks — the automations that run an
 * agent without the user present: MCP event subscriptions, which agents create
 * in conversation, and generic webhooks, which a member creates on the agent's
 * Webhook page. Personal or workspace scope comes from the active workspace the
 * TRPC client already sends.
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

  /** A generic webhook for the agent; the result carries its call URL. */
  create = async (agentId: string, settings: GenericWebhookSettings) =>
    lambdaClient.inboundWebhook.create.mutate({ agentId, ...settings });

  update = async (id: string, changes: GenericWebhookSettings & { paused?: boolean }) =>
    lambdaClient.inboundWebhook.update.mutate({ id, ...changes });

  /** A new call URL; the previous one stops working at once. */
  rotateToken = async (id: string) => lambdaClient.inboundWebhook.rotateToken.mutate({ id });

  /** A sample call through the real receiver: it wakes the agent like any caller would. */
  sendTest = async (id: string) => lambdaClient.inboundWebhook.sendTest.mutate({ id });

  listDeliveries = async (id: string, cursor?: { createdAt: string; id: string }) =>
    lambdaClient.inboundWebhook.listDeliveries.query({ cursor, id });
}

export const inboundWebhookService = new InboundWebhookService();
