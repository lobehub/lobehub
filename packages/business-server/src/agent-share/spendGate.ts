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
   * The creator's configured cap for this share, in USD.
   * `undefined` / `null` means the creator set no cap.
   */
  monthlySpendLimit?: number | null;
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
