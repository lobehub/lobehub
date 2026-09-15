/** Durable producer families which can pause an agent run for a person. */
export const AGENT_INTERVENTION_SOURCES = ['runtime', 'heterogeneous'] as const;

export type AgentInterventionSource = (typeof AGENT_INTERVENTION_SOURCES)[number];

/**
 * Semantic interaction kinds. `surface` separately describes whether the
 * client renders binary controls or a form.
 */
export const AGENT_INTERVENTION_KINDS = [
  'tool_approval',
  'custom',
  'question',
  'permission',
  'plan',
] as const;

export type AgentInterventionKind = (typeof AGENT_INTERVENTION_KINDS)[number];

export const AGENT_INTERVENTION_SURFACES = ['binary', 'form'] as const;

export type AgentInterventionSurface = (typeof AGENT_INTERVENTION_SURFACES)[number];

export const AGENT_INTERVENTION_SYSTEM_ACTION_ELIGIBILITIES = [
  'review_only',
  'safe_single_binary',
] as const;

export type AgentInterventionSystemActionEligibility =
  (typeof AGENT_INTERVENTION_SYSTEM_ACTION_ELIGIBILITIES)[number];

/** Includes the server-only headless mode even though Web does not expose it. */
export const AGENT_INTERVENTION_APPROVAL_MODES = [
  'auto-run',
  'allow-list',
  'manual',
  'headless',
] as const;

export type AgentInterventionApprovalMode = (typeof AGENT_INTERVENTION_APPROVAL_MODES)[number];

/** Producer-supported actions; caller authorization is a separate concern. */
export const AGENT_INTERVENTION_ALLOWED_ACTIONS = [
  'approve',
  'approve_remember',
  'reject_continue',
  'stop',
  'edit_arguments',
  'select_provider_option',
  'submit_answers',
  'submit_custom',
  'skip_interaction',
  'cancel_interaction',
] as const;

export type AgentInterventionAllowedAction = (typeof AGENT_INTERVENTION_ALLOWED_ACTIONS)[number];

export const AGENT_INTERVENTION_STATUSES = [
  'pending',
  'resolving',
  'published',
  'resolved',
  'cancelled',
  'timed_out',
  'session_ended',
] as const;

export type AgentInterventionStatus = (typeof AGENT_INTERVENTION_STATUSES)[number];

export const AGENT_INTERVENTION_RESOLUTION_SCOPES = ['single', 'selected', 'all'] as const;

export type AgentInterventionResolutionScope =
  (typeof AGENT_INTERVENTION_RESOLUTION_SCOPES)[number];

export const AGENT_INTERVENTION_RESOLUTION_STATUSES = [
  'resolving',
  'published',
  'acknowledged',
  'completed',
  'rolled_back',
  'timed_out',
  'session_ended',
] as const;

export type AgentInterventionResolutionStatus =
  (typeof AGENT_INTERVENTION_RESOLUTION_STATUSES)[number];

/** Private execution lifecycle for custom intervention side effects. */
export const AGENT_INTERVENTION_CUSTOM_EXECUTION_STATES = [
  'pending',
  'executing',
  'completed',
] as const;

export type AgentInterventionCustomExecutionState =
  (typeof AGENT_INTERVENTION_CUSTOM_EXECUTION_STATES)[number];

/** Durable private result replayed to the custom-intervention executor only. */
export interface AgentInterventionCustomExecutionResult {
  content: string;
  pluginState: Record<string, unknown>;
}

export const AGENT_INTERVENTION_REMEMBER_EFFECT_STATUSES = [
  'applied',
  'retained',
  'rolled_back',
] as const;

export type AgentInterventionRememberEffectStatus =
  (typeof AGENT_INTERVENTION_REMEMBER_EFFECT_STATUSES)[number];

export const AGENT_INTERVENTION_ARGUMENT_EFFECT_STATUSES = [
  'applied',
  'retained',
  'rolled_back',
] as const;

export type AgentInterventionArgumentEffectStatus =
  (typeof AGENT_INTERVENTION_ARGUMENT_EFFECT_STATUSES)[number];

export const AGENT_INTERVENTION_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

export type AgentInterventionRiskLevel = (typeof AGENT_INTERVENTION_RISK_LEVELS)[number];

/** Notification-safe risk summary. It must not contain raw tool arguments. */
export interface AgentInterventionRisk {
  level: AgentInterventionRiskLevel;
  summary?: string;
  warnings?: string[];
}

/** A producer-provided choice after sensitive arguments have been removed. */
export interface AgentInterventionOption {
  description?: string;
  id?: string;
  label: string;
  recommended?: boolean;
}

/** One structured question preserved for cold-start Review rendering. */
export interface AgentInterventionQuestion {
  allowCustomAnswer?: boolean;
  header?: string;
  id?: string;
  multiSelect?: boolean;
  options: AgentInterventionOption[];
  question: string;
}

export interface AgentInterventionAnswerPolicy {
  allowFreeform?: boolean;
  allowSupplement?: boolean;
}

export type AgentInterventionFormFieldType =
  'boolean' | 'multi_select' | 'number' | 'single_select' | 'text';

/** Sanitized custom-form metadata. Answers live only in the resolution outbox. */
export interface AgentInterventionFormField {
  description?: string;
  id: string;
  label: string;
  options?: AgentInterventionOption[];
  required?: boolean;
  type: AgentInterventionFormFieldType;
}

export interface AgentMarketplaceInterventionAgent {
  avatar?: string;
  description?: string;
  id: string;
  title: string;
}

/** Notification-safe detail needed to reconstruct the Web marketplace picker. */
export interface AgentMarketplaceInterventionDetail {
  agents: AgentMarketplaceInterventionAgent[];
  categoryHints?: string[];
  kind: 'agent_marketplace';
  requestId?: string;
  selectedIds?: string[];
}

export type AgentInterventionCustomDetail = AgentMarketplaceInterventionDetail;

/**
 * Durable render metadata. Raw arguments deliberately do not belong here: an
 * authorized Review service loads them from the authoritative tool message by
 * `toolMessageId`, then verifies `requestRevisionHash` before mutation.
 */
export interface AgentInterventionSanitizedRequest {
  answerPolicy?: AgentInterventionAnswerPolicy;
  apiName: string;
  argumentCount?: number;
  customDetail?: AgentInterventionCustomDetail;
  fields?: AgentInterventionFormField[];
  identifier?: string;
  options?: AgentInterventionOption[];
  parameterNames?: string[];
  prompt?: string;
  questions?: AgentInterventionQuestion[];
}

/** Short copy safe to place on notification and Live Activity surfaces. */
export interface AgentInterventionReviewContext {
  agentLabel?: string;
  resourceLabel?: string;
  summary?: string;
  title: string;
}

export type AgentInterventionFormValue = boolean | number | string | string[] | null;

export type AgentInterventionFormAnswers = Record<string, AgentInterventionFormValue>;

/** Schema-validated, deliberately shallow result accepted from bespoke forms. */
export type AgentInterventionCustomResult = Record<string, AgentInterventionFormValue>;

/**
 * Discriminated private outbox payload. Only user-edited arguments may be
 * retained here for reliable delivery; original raw arguments never enter the
 * notification-facing intervention row.
 */
export type AgentInterventionResolutionAction =
  | {
      editedArguments?: Record<string, unknown>;
      type: 'approve';
    }
  | {
      editedArguments?: Record<string, unknown>;
      type: 'approve_remember';
    }
  | { reason?: string; type: 'reject_continue' }
  | { haltScope: 'operation'; reason?: string; type: 'stop' }
  | { optionId: string; type: 'select_provider_option' }
  | { answers: AgentInterventionFormAnswers; type: 'submit_answers' }
  | {
      expectedRevisionHash: string;
      result: AgentInterventionCustomResult;
      type: 'submit_custom';
    }
  | { type: 'skip_interaction' }
  | { type: 'cancel_interaction' };

/** Versions from the exact Review snapshot used to make a batch decision. */
export type AgentInterventionExpectedVersions = Record<string, number>;

/** Revision hashes for every member of the sealed batch Review snapshot. */
export type AgentInterventionExpectedRequestRevisionHashes = Record<string, string>;
