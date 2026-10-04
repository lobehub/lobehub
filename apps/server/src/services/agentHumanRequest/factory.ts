import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentAccountService } from '@/server/services/agentIdentity';
import { AgentInboxService } from '@/server/services/agentIdentity/inbox';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';

import { AgentHumanRequestService, type AgentHumanRequestServiceOptions } from './index';
import { createAgentHumanRequestNotifier } from './notifier';

const normalizeAddress = (value: string) => value.trim().toLowerCase();

/**
 * The production wiring: per-request keys sealed with the KeyVaults key, the
 * action performed through the agent's own account, and the outcome reported
 * back to the agent as a new turn. Tests construct the service directly with
 * their own collaborators instead.
 */
export const createAgentHumanRequestService = async (
  db: LobeChatDatabase,
  userId: string,
  options: { notify?: boolean; workspaceId?: string } = {},
) => {
  const { workspaceId } = options;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const accounts = new AgentAccountService(db, userId, {
    gateKeeper,
    registry: createDefaultAgentAccountRegistry(),
    workspaceId,
  });
  const inbox = new AgentInboxService(db, userId, workspaceId);

  const sender: AgentHumanRequestServiceOptions['sender'] = async (accountId, message) => {
    // An approved reply still answers the sender's original message, so a
    // provider with a native reply call keeps the thread together.
    let replyToProviderMessageId: string | undefined;
    if (message.threadKey) {
      const thread = await inbox.list({ accountId, limit: 50, threadKey: message.threadKey });
      replyToProviderMessageId = thread.find(
        (row) => normalizeAddress(row.from) === normalizeAddress(message.to),
      )?.providerMessageId;
    }

    return accounts.send(accountId, { ...message, replyToProviderMessageId });
  };

  return new AgentHumanRequestService(db, userId, {
    notifier:
      options.notify === false
        ? undefined
        : createAgentHumanRequestNotifier(db, userId, workspaceId),
    sealer: gateKeeper,
    sender,
    workspaceId,
  });
};
