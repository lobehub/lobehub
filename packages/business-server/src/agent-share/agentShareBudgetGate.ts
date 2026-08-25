export interface GetAgentShareBudgetRemainingParams {
  agentId: string;
}

/**
 * Optional business hook for products that meter shared-agent usage.
 *
 * Returns the remaining share budget in USD, or `null` when the deployment
 * has no share budget system (OSS default). Callers must treat `null` as
 * "not gated" — never as an exhausted budget.
 */
export async function getAgentShareBudgetRemaining(
  _params: GetAgentShareBudgetRemainingParams,
): Promise<number | null> {
  return null;
}
