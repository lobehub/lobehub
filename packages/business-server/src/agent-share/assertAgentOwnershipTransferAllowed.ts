export interface AssertAgentOwnershipTransferAllowedParams {
  agentId: string;
  fromUserId: string;
  toUserId: string;
}

/** Optional business hook for products that attach owner-scoped state to an agent. */
export async function assertAgentOwnershipTransferAllowed(
  _params: AssertAgentOwnershipTransferAllowedParams,
): Promise<void> {}
