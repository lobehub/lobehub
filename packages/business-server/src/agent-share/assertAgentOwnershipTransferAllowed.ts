import type { LobeChatDatabase } from '@lobechat/database';

export type AgentOwnershipLockExecutor = Pick<LobeChatDatabase, 'execute'>;

export interface AssertAgentOwnershipTransferAllowedParams {
  agentId: string;
  executor?: AgentOwnershipLockExecutor;
  fromUserId: string;
  toUserId: string;
}

export interface AssertAgentDeletionAllowedParams {
  agentId: string;
  executor?: AgentOwnershipLockExecutor;
  userId: string;
}

/** Optional business hook for serializing owner-scoped state changes with a handover. */
export async function lockAgentOwnershipTransfer(
  _executor: AgentOwnershipLockExecutor,
  _agentId: string,
): Promise<void> {}

/** Optional business hook for products that attach owner-scoped state to an agent. */
export async function assertAgentOwnershipTransferAllowed(
  _params: AssertAgentOwnershipTransferAllowedParams,
): Promise<void> {}

/** Optional business hook for products that attach durable state to an agent. */
export async function assertAgentDeletionAllowed(
  _params: AssertAgentDeletionAllowedParams,
): Promise<void> {}
