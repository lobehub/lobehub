import { WebhookIdentifier } from '@lobechat/builtin-tool-webhook';
import { WebhookExecutionRuntime } from '@lobechat/builtin-tool-webhook/executionRuntime';

import { channelOriginOfRun } from '@/server/services/inboundWebhook/channelDelivery';
import { InboundWebhookManager } from '@/server/services/inboundWebhook/manage';

import type { ServerRuntimeRegistration } from './types';

/**
 * The agent's webhook tools, managing as the signed-in user. No `workspaceRole` is passed, so the
 * agent never gets a workspace admin's reach: it manages only the webhooks its user created.
 * A share visitor's run never gets here (the tool is not share-allowed); refuse it regardless.
 */
export const webhookRuntime: ServerRuntimeRegistration = {
  identifier: WebhookIdentifier,
  factory: (context) => {
    const { agentId, agentShareVisitor, operationId, serverDB: db, userId } = context;
    if (!db || !userId || !agentId || agentShareVisitor)
      throw new Error('Webhook tools require the signed-in owner of the agent');
    return new WebhookExecutionRuntime(
      new InboundWebhookManager(db, { userId, workspaceId: context.workspaceId }),
      {
        agentId,
        channelOrigin: async () => (operationId ? channelOriginOfRun(db, operationId) : undefined),
      },
    );
  },
};
