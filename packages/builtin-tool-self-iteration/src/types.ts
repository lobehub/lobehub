/** Builtin identifier used to route self-feedback intent declarations. */
export const SELF_FEEDBACK_INTENT_IDENTIFIER = 'lobe-self-feedback-intent';

/** Runtime API name used by the injected self-feedback intent tool. */
export const SELF_FEEDBACK_INTENT_API_NAME = 'declareSelfFeedbackIntent';

/** LLM-visible tool name generated from identifier and API name. */
export const SELF_FEEDBACK_INTENT_TOOL_NAME = `${SELF_FEEDBACK_INTENT_IDENTIFIER}____${SELF_FEEDBACK_INTENT_API_NAME}`;

/** Stable API name map used by manifests, runtimes, and inspectors. */
export const SelfFeedbackIntentApiName = {
  declareSelfFeedbackIntent: SELF_FEEDBACK_INTENT_API_NAME,
} as const;

export type SelfFeedbackIntentApiNameType =
  (typeof SelfFeedbackIntentApiName)[keyof typeof SelfFeedbackIntentApiName];

export const SELF_FEEDBACK_INTENT_ACTIONS = [
  'write',
  'create',
  'refine',
  'consolidate',
  'proposal',
] as const;

export const SELF_FEEDBACK_INTENT_KINDS = ['memory', 'skill', 'gap'] as const;

export const SELF_FEEDBACK_INTENT_EVIDENCE_REF_TYPES = [
  'topic',
  'message',
  'operation',
  'source',
  'receipt',
  'tool_call',
  'task',
  'agent_document',
  'memory',
] as const;

/** Actions that an agent may declare as self-feedback intent. */
export type SelfFeedbackIntentAction = (typeof SELF_FEEDBACK_INTENT_ACTIONS)[number];

/** Self-feedback target categories accepted from agent-declared intent. */
export type SelfFeedbackIntentKind = (typeof SELF_FEEDBACK_INTENT_KINDS)[number];

/** Evidence reference type accepted by downstream self-iteration handlers. */
export type SelfFeedbackIntentEvidenceRefType =
  (typeof SELF_FEEDBACK_INTENT_EVIDENCE_REF_TYPES)[number];

/** Evidence strength assigned to one accepted or rejected declaration. */
export type SelfFeedbackIntentStrength = 'strong' | 'weak';

/** Optional reference that grounds one self-feedback declaration. */
export interface SelfFeedbackIntentEvidenceRef {
  /** Stable evidence identifier in its source domain. */
  id: string;
  /** Optional short note explaining why this evidence matters. */
  summary?: string;
  /** Evidence object type. */
  type: SelfFeedbackIntentEvidenceRefType;
}

/** Input payload declared by the running agent through the self-feedback intent tool. */
export interface DeclareSelfFeedbackIntentPayload {
  /** Self-feedback action the agent believes may be useful. */
  action: SelfFeedbackIntentAction;
  /** Agent confidence from 0 to 1. */
  confidence: number;
  /** Evidence references that justify the declaration. */
  evidenceRefs?: SelfFeedbackIntentEvidenceRef[];
  /** Target category for the declaration. */
  kind: SelfFeedbackIntentKind;
  /** Existing memory id when the declaration targets a known memory. */
  memoryId?: string;
  /** Human-readable rationale from the agent. */
  reason: string;
  /** Existing skill id when the declaration targets a known skill. */
  skillId?: string;
  /** Short declaration summary for downstream review. */
  summary: string;
}

export type DeclareSelfFeedbackIntentParams = DeclareSelfFeedbackIntentPayload;

/** Runtime context required to emit one self-feedback declaration. */
export interface DeclareSelfFeedbackIntentContext {
  /** Stable agent id associated with the running agent. */
  agentId?: string;
  /** Runtime operation id when the declaration belongs to a narrower operation scope. */
  operationId?: string;
  /** Caller-provided tool-call id. */
  toolCallId?: string;
  /** Current topic id for stable source ids and topic fallback scope. */
  topicId?: string;
  /** Stable user id associated with the running agent. */
  userId?: string;
}

/** Input used by a runtime service to declare one self-feedback source event. */
export interface DeclareSelfFeedbackIntentInput {
  /** Stable agent id associated with the running agent. */
  agentId: string;
  /** Agent-declared self-feedback intent payload. */
  input: DeclareSelfFeedbackIntentPayload;
  /** Runtime operation id when the declaration belongs to a narrower operation scope. */
  operationId?: string;
  /** Caller-provided tool-call id. */
  toolCallId?: string;
  /** Current topic id for stable source ids and topic fallback scope. */
  topicId: string;
  /** Stable user id associated with the running agent. */
  userId: string;
}

export type DeclareSelfFeedbackIntentRejectionReason =
  | 'enqueue_gate_rejected'
  | 'intent_gate_rejected'
  | 'invalid_action'
  | 'invalid_confidence'
  | 'invalid_kind'
  | 'rate_limited';

/** Result returned after one declaration attempt. */
export interface DeclareSelfFeedbackIntentResult {
  /** Whether the declaration was accepted and emitted to the enqueue boundary. */
  accepted: boolean;
  /** Optional rejection reason when no source was enqueued. */
  reason?: DeclareSelfFeedbackIntentRejectionReason;
  /** Stable source id built for accepted declarations when available. */
  sourceId?: string;
  /** Evidence strength assigned from confidence and evidence presence. */
  strength: SelfFeedbackIntentStrength;
}

export type DeclareSelfFeedbackIntentStateReason =
  | DeclareSelfFeedbackIntentRejectionReason
  | 'missing_context'
  | 'runtime_error'
  | null;

/** State persisted for inspector display after one self-feedback declaration. */
export interface DeclareSelfFeedbackIntentState {
  /** Whether the declaration crossed the Agent Signal enqueue boundary. */
  accepted: boolean;
  /** Missing context keys when the runtime cannot emit the declaration. */
  required?: string[];
  /** Rejection or runtime reason. */
  reason: DeclareSelfFeedbackIntentStateReason;
  /** Stable source id for accepted declarations. */
  sourceId?: null | string;
  /** Evidence strength assigned by the declaration service. */
  strength?: SelfFeedbackIntentStrength;
}

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
