/** Builtin identifier used to route self-feedback intent declarations. */
export const SELF_FEEDBACK_INTENT_IDENTIFIER = 'lobe-self-feedback-intent';

/** Runtime API name used by the injected self-feedback intent tool. */
export const SELF_FEEDBACK_INTENT_API_NAME = 'declareSelfFeedbackIntent';

/** LLM-visible tool name generated from identifier and API name. */
export const SELF_FEEDBACK_INTENT_TOOL_NAME = `${SELF_FEEDBACK_INTENT_IDENTIFIER}____${SELF_FEEDBACK_INTENT_API_NAME}`;

/** Gate input used to decide whether the declaration tool may be exposed. */
export interface ShouldExposeSelfFeedbackIntentToolOptions {
  /** Agent-level self-iteration chat config gate. */
  agentSelfIterationEnabled: boolean;
  /** Generic tool disable flag for this execution path. */
  disabled?: boolean;
  /** Explicit future-facing disable flag for reviewer/runtime callers. */
  disableSelfFeedbackIntentTool?: boolean;
  /** Server/user feature gate result, including user Labs eligibility. */
  featureUserEnabled: boolean;
  /** Reviewer paths must not receive the running-agent declaration tool. */
  reviewerRole?: boolean;
}
