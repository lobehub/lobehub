import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import {
  AgentHumanRequestService,
  type AgentHumanRequestServiceOptions,
  unavailableSender,
} from './index';
import { createAgentHumanRequestNotifier } from './notifier';

export interface CreateAgentHumanRequestServiceOptions {
  /** Set to `false` to skip waking the agent with the outcome. */
  notify?: boolean;
  /** Performs the bound action. Defaults to {@link unavailableSender}. */
  sender?: AgentHumanRequestServiceOptions['sender'];
  workspaceId?: string;
}

/**
 * The production wiring: per-request keys sealed with the KeyVaults key and
 * the outcome reported back to the agent as a new turn. Tests construct the
 * service directly with their own collaborators instead.
 */
export const createAgentHumanRequestService = async (
  db: LobeChatDatabase,
  userId: string,
  options: CreateAgentHumanRequestServiceOptions = {},
) => {
  const { workspaceId } = options;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return new AgentHumanRequestService(db, userId, {
    notifier:
      options.notify === false
        ? undefined
        : createAgentHumanRequestNotifier(db, userId, workspaceId),
    sealer: gateKeeper,
    sender: options.sender ?? unavailableSender,
    workspaceId,
  });
};
