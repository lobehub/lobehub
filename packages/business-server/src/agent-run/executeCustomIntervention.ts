export interface ExecuteAgentMarketplaceInterventionParams {
  action:
    | { selectedTemplateIds: string[]; type: 'submitted' }
    | { type: 'skipped' }
    | { type: 'cancelled' };
  actorUserId: string;
  categoryHints: string[];
  requestId: string;
  /** Stable generic-resolution idempotency key for durable execute-once semantics. */
  resolutionRequestId: string;
  topicId: string;
  userId: string;
  workspaceId?: string;
}

export interface ExecuteCustomInterventionResult {
  content: string;
  pluginState: Record<string, unknown>;
}

export interface GetAgentMarketplaceInterventionReviewParams {
  categoryHints: string[];
  prompt?: string;
  requestId: string;
  userId: string;
  workspaceId?: string;
}

export interface AgentMarketplaceInterventionReviewAgent {
  avatar?: string;
  description?: string;
  id: string;
  title: string;
}

/**
 * Notification-safe marketplace projection. Cloud overrides this alongside
 * the post-claim executor so Review clients can render an actual picker while
 * the OSS default remains inert.
 */
export async function getAgentMarketplaceInterventionReview(
  _params: GetAgentMarketplaceInterventionReviewParams,
): Promise<AgentMarketplaceInterventionReviewAgent[]> {
  return [];
}

/**
 * Post-claim server-side custom interaction registry.
 *
 * Cloud overrides this handler to install the selected marketplace agents,
 * persist the onboarding pick on the authoritative topic, and return the
 * final tool result/plugin state. The implementation MUST be strongly
 * idempotent by `resolutionRequestId`: a retry after the durable side effect
 * but before the source message/continuation write must reconstruct the same
 * result without installing or recording twice. It may only return after that
 * execute-once record is durable, and post-commit fanout errors must not escape.
 * The default OSS build fails closed: custom side effects must never fall back
 * to an unvalidated browser-only action when a token-based resolver is used.
 */
export async function executeAgentMarketplaceIntervention(
  _params: ExecuteAgentMarketplaceInterventionParams,
): Promise<ExecuteCustomInterventionResult> {
  throw new Error('Agent marketplace intervention is unavailable on this server');
}
