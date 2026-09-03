/**
 * Optional business hook for deployments that meter shared-agent usage.
 *
 * A shared agent runs under its CREATOR's identity, so every visitor turn is
 * billed to the creator. `AgentShareConfig.monthlySpendLimit` lets the creator
 * bound that exposure; this slot is where a deployment that actually tracks
 * spend decides whether the next visitor run may start.
 *
 * The slot is a pure admission check called BEFORE any topic/message row is
 * created — the caller is responsible for turning a denial into a
 * visitor-facing error.
 */
export interface AgentShareSpendGateParams {
  /** The shared agent. */
  agentId: string;
  /**
   * The creator's configured cap for this share, in USD. Always present —
   * `normalizeAgentShareConfig` guarantees a share carries a cap, and `0` is a
   * real lower bound meaning "stop all visitor runs".
   */
  monthlySpendLimit: number;
  /** The creator whose account is billed for this run. */
  ownerUserId: string;
  /** The `agentShares.id` this run is authorized against. */
  shareId: string;
  /** The signed-in visitor asking to run the agent. */
  visitorUserId: string;
}

export interface AgentShareSpendGateResult {
  /** `false` rejects the run before any row is written. */
  allowed: boolean;
}

/**
 * Default: no spend accounting, so nothing is ever refused. A deployment that
 * meters shared-agent spend overrides this module.
 */
export async function checkAgentShareSpendAllowance(
  _params: AgentShareSpendGateParams,
): Promise<AgentShareSpendGateResult> {
  return { allowed: true };
}

/**
 * Spend already billed to the creator by visitor runs of one shared agent in
 * the current calendar month, for the creator's own usage panel.
 *
 * Read-only companion to {@link checkAgentShareSpendAllowance}: same source of
 * truth, but reported instead of enforced.
 *
 * Default: `null`, meaning "this deployment does not meter shared-agent
 * spend". Callers must render that as unknown, NOT as `0` — a zero would read
 * as "nothing has been spent", which is a different and misleading claim.
 */
export async function getAgentShareMonthlySpend(_params: {
  agentId: string;
  ownerUserId: string;
}): Promise<number | null> {
  return null;
}
