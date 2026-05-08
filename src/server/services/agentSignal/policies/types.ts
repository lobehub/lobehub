import type { BaseAction, BaseSignal } from '@lobechat/agent-signal';
import type {
  SourceAgentExecutionCompleted,
  SourceAgentExecutionFailed,
  SourceRuntimeAfterStep,
  SourceRuntimeBeforeStep,
} from '@lobechat/agent-signal/source';

/** Server-owned built-in AgentSignal policy identifiers. */
export const AGENT_SIGNAL_POLICIES = {
  feedbackActionPlanner: 'feedback-action-planner',
  feedbackDomainJudge: 'feedback-domain-judge',
  feedbackSatisfactionJudge: 'feedback-satisfaction-judge',
  nudgeMemory: 'nudge.memory',
  selfReflectionAnalysis: 'self-reflection-analysis',
} as const;

/** Server-owned built-in AgentSignal signal type identifiers. */
export const AGENT_SIGNAL_POLICY_SIGNAL_TYPES = {
  feedbackDomainMemory: 'signal.feedback.domain.memory',
  feedbackDomainNone: 'signal.feedback.domain.none',
  feedbackDomainPrompt: 'signal.feedback.domain.prompt',
  feedbackDomainSkill: 'signal.feedback.domain.skill',
  feedbackSatisfaction: 'signal.feedback.satisfaction',
  nudgeMemoryConditionMatched: 'signal.nudge.memory.condition-matched',
  nudgeMemoryConditionMismatched: 'signal.nudge.memory.condition-mismatched',
  procedureBucketScored: 'signal.procedure.bucket.scored',
  selfReflectionNeeded: 'signal.self-reflection-analysis.reflect-needed',
  selfReflectionSkipped: 'signal.self-reflection-analysis.reflect-skipped',
  toolOutcome: 'signal.tool.outcome',
} as const;

/** Server-owned built-in AgentSignal action type identifiers. */
export const AGENT_SIGNAL_POLICY_ACTION_TYPES = {
  nudgeHandle: 'action.nudge.handle',
  personaHandle: 'action.persona.handle',
  skillManagementHandle: 'action.skill-management.handle',
  userMemoryHandle: 'action.user-memory.handle',
} as const;

type ValueOf<TValue> = TValue[keyof TValue];

/** Server-owned built-in AgentSignal signal type union. */
export type AgentSignalPolicySignalType = ValueOf<typeof AGENT_SIGNAL_POLICY_SIGNAL_TYPES>;

/** Server-owned built-in AgentSignal action type union. */
export type AgentSignalPolicyActionType = ValueOf<typeof AGENT_SIGNAL_POLICY_ACTION_TYPES>;

export type AgentSignalFeedbackSatisfactionResult = 'neutral' | 'not_satisfied' | 'satisfied';

export type AgentSignalFeedbackDomainTarget = 'memory' | 'none' | 'prompt' | 'skill';

export type AgentSignalFeedbackPhase1DomainTarget = 'memory' | 'prompt' | 'skill';

export type AgentSignalSkillIntentExplicitness =
  | 'explicit_action'
  | 'implicit_strong_learning'
  | 'non_skill_preference'
  | 'weak_positive';

export type AgentSignalSkillActionIntent =
  | 'consolidate'
  | 'create'
  | 'maintain'
  | 'noop'
  | 'refine';

export type AgentSignalSkillIntentRoute = 'accumulate' | 'direct_decision' | 'non_skill';

/** Sanitized classifier error details safe enough for traces and eval diagnostics. */
export interface AgentSignalClassifierErrorSummary {
  /** Sanitized one-hop cause summary when the runtime attached `error.cause`. */
  cause?: string;
  /** Error message with likely secrets redacted and length bounded. */
  message: string;
  /** Error class or runtime-provided error type. */
  name?: string;
}

/**
 * Compact routing decision for one skill-domain feedback signal.
 */
export interface AgentSignalSkillIntentClassification {
  /** Durable skill-management action hint selected before the decision agent runs. */
  actionIntent?: AgentSignalSkillActionIntent;
  /** Sanitized classifier failure details when fallback classification failed. */
  classifierError?: AgentSignalClassifierErrorSummary;
  /** Confidence of the rule or model classifier, from 0 to 1. */
  confidence: number;
  /** Whether the feedback is explicit, implicit strong learning, weak positive, or non-skill preference. */
  explicitness: AgentSignalSkillIntentExplicitness;
  /** Short private-safe reason suitable for traces and eval assertions. */
  reason: string;
  /** Runtime route used by action planning. */
  route: AgentSignalSkillIntentRoute;
}

export interface AgentSignalFeedbackEvidence {
  cue: string;
  excerpt: string;
}

/** Future-facing slim payload for the satisfaction stage. */
export interface AgentSignalFeedbackSatisfactionStagePayload {
  confidence: number;
  evidence: AgentSignalFeedbackEvidence[];
  reason: string;
  result: AgentSignalFeedbackSatisfactionResult;
}

/** Future-facing slim payload for one domain stage result. */
export interface AgentSignalFeedbackDomainStagePayload<
  TTarget extends AgentSignalFeedbackDomainTarget,
> {
  confidence: number;
  evidence: AgentSignalFeedbackEvidence[];
  reason: string;
  skillActionIntent?: AgentSignalSkillActionIntent;
  skillIntentConfidence?: number;
  skillIntentError?: AgentSignalClassifierErrorSummary;
  skillIntentExplicitness?: AgentSignalSkillIntentExplicitness;
  skillIntentReason?: string;
  skillRoute?: AgentSignalSkillIntentRoute;
  target: TTarget;
}

/**
 * Structured source hints already attached to one feedback source event.
 */
export interface AgentSignalFeedbackSourceHints {
  documentPayload?: Record<string, unknown>;
  intents?: Array<'document' | 'memory' | 'persona' | 'prompt' | 'skill'>;
  memoryPayload?: Record<string, unknown>;
}

export interface AgentSignalFeedbackDomainConflictPolicy {
  forbiddenWith?: AgentSignalFeedbackDomainTarget[];
  mode: 'exclusive' | 'fanout';
  priority: number;
}

/** Server-owned built-in AgentSignal signal payloads keyed by signal type. */
export interface AgentSignalPolicySignalPayloadMap {
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainMemory]: {
    agentId?: string;
    confidence: number;
    conflictPolicy: AgentSignalFeedbackDomainConflictPolicy;
    evidence: AgentSignalFeedbackEvidence[];
    message: string;
    messageId: string;
    reason: string;
    satisfactionResult: AgentSignalFeedbackSatisfactionResult;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    target: 'memory';
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainNone]: {
    agentId?: string;
    confidence: number;
    conflictPolicy: AgentSignalFeedbackDomainConflictPolicy;
    evidence: AgentSignalFeedbackEvidence[];
    message: string;
    messageId: string;
    reason: string;
    satisfactionResult: AgentSignalFeedbackSatisfactionResult;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    target: 'none';
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainPrompt]: {
    agentId?: string;
    confidence: number;
    conflictPolicy: AgentSignalFeedbackDomainConflictPolicy;
    evidence: AgentSignalFeedbackEvidence[];
    message: string;
    messageId: string;
    reason: string;
    satisfactionResult: AgentSignalFeedbackSatisfactionResult;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    target: 'prompt';
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainSkill]: {
    agentId?: string;
    confidence: number;
    conflictPolicy: AgentSignalFeedbackDomainConflictPolicy;
    evidence: AgentSignalFeedbackEvidence[];
    message: string;
    messageId: string;
    reason: string;
    satisfactionResult: AgentSignalFeedbackSatisfactionResult;
    serializedContext?: string;
    skillActionIntent?: AgentSignalSkillActionIntent;
    skillIntentError?: AgentSignalClassifierErrorSummary;
    skillIntentConfidence?: number;
    skillIntentExplicitness?: AgentSignalSkillIntentExplicitness;
    skillIntentReason?: string;
    skillRoute?: AgentSignalSkillIntentRoute;
    sourceHints?: AgentSignalFeedbackSourceHints;
    target: 'skill';
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackSatisfaction]: {
    agentId?: string;
    confidence: number;
    evidence: AgentSignalFeedbackEvidence[];
    message: string;
    messageId: string;
    reason: string;
    result: AgentSignalFeedbackSatisfactionResult;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.nudgeMemoryConditionMatched]: {
    agentId?: string;
    condition: 'memory-conflict-detected' | 'memory-refresh-needed' | 'memory-reinforcement-needed';
    operationId?: string;
    serializedContext?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.nudgeMemoryConditionMismatched]: {
    agentId?: string;
    condition: 'memory-conflict-detected' | 'memory-refresh-needed' | 'memory-reinforcement-needed';
    operationId?: string;
    reason: 'cooldown-active' | 'no-relevant-memory' | 'policy-filtered' | 'threshold-not-reached';
    serializedContext?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.procedureBucketScored]: {
    aggregateScore: number;
    bucketKey: string;
    confidence: number;
    domain: string;
    itemScores: Array<{
      reasons: string[];
      recordId: string;
      score: number;
      suggestedAction?: 'handle' | 'ignore' | 'maintain' | 'review' | 'summarize';
    }>;
    recordIds: string[];
    suggestedActions: string[];
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.selfReflectionNeeded]: {
    agentId?: string;
    operationId: string;
    outcome: 'failed' | 'resolved' | 'succeeded';
    reason:
      | 'execution-failed'
      | 'repeated-repair'
      | 'successful-resolution'
      | 'unexpected-tool-result';
    serializedContext?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.selfReflectionSkipped]: {
    agentId?: string;
    operationId: string;
    outcome: 'failed' | 'resolved' | 'succeeded';
    reason: 'cooldown-active' | 'insufficient-context' | 'no-learning-value' | 'policy-filtered';
    serializedContext?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_SIGNAL_TYPES.toolOutcome]: {
    agentId?: string;
    domainKey?: string;
    intentClass?: string;
    messageId?: string;
    operationId?: string;
    outcome: {
      action?: string;
      errorReason?: string;
      status: 'failed' | 'skipped' | 'succeeded';
      summary?: string;
    };
    relatedObjects?: Array<{ objectId: string; objectType: string; relation?: string }>;
    taskId?: string;
    tool: { apiName?: string; identifier: string };
    toolCallId?: string;
    topicId?: string;
  };
}

/** Server-owned built-in AgentSignal action payloads keyed by action type. */
export interface AgentSignalPolicyActionPayloadMap {
  [AGENT_SIGNAL_POLICY_ACTION_TYPES.nudgeHandle]: {
    agentId?: string;
    condition: 'memory-conflict-detected' | 'memory-refresh-needed' | 'memory-reinforcement-needed';
    idempotencyKey?: string;
    operationId?: string;
    serializedContext?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_ACTION_TYPES.personaHandle]: {
    agentId?: string;
    idempotencyKey: string;
    message: string;
    serializedContext?: string;
    topicId?: string;
    update?: Record<string, unknown>;
  };
  [AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle]: {
    agentId?: string;
    conflictPolicy?: AgentSignalFeedbackDomainConflictPolicy;
    evidence?: AgentSignalFeedbackEvidence[];
    feedbackHint?: Exclude<AgentSignalFeedbackSatisfactionResult, 'neutral'>;
    idempotencyKey: string;
    message: string;
    messageId?: string;
    reason?: string;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    topicId?: string;
  };
  [AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle]: {
    agentId?: string;
    conflictPolicy?: AgentSignalFeedbackDomainConflictPolicy;
    evidence?: AgentSignalFeedbackEvidence[];
    feedbackHint?: Exclude<AgentSignalFeedbackSatisfactionResult, 'neutral'>;
    idempotencyKey: string;
    message: string;
    messageId?: string;
    reason?: string;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    topicId?: string;
  };
}

/** Server-owned built-in AgentSignal signal variant. */
export type AgentSignalPolicySignalVariant<
  TSignalType extends AgentSignalPolicySignalType = AgentSignalPolicySignalType,
> = BaseSignal & {
  payload: AgentSignalPolicySignalPayloadMap[TSignalType];
  signalType: TSignalType;
};

/** Server-owned built-in AgentSignal signal union. */
export type AgentSignalPolicySignal = {
  [TSignalType in AgentSignalPolicySignalType]: AgentSignalPolicySignalVariant<TSignalType>;
}[AgentSignalPolicySignalType];

/** Server-owned built-in AgentSignal action variant. */
export type AgentSignalPolicyActionVariant<
  TActionType extends AgentSignalPolicyActionType = AgentSignalPolicyActionType,
> = BaseAction & {
  actionType: TActionType;
  payload: AgentSignalPolicyActionPayloadMap[TActionType];
};

/** Server-owned built-in AgentSignal action union. */
export type AgentSignalPolicyAction = {
  [TActionType in AgentSignalPolicyActionType]: AgentSignalPolicyActionVariant<TActionType>;
}[AgentSignalPolicyActionType];

export type SignalFeedbackSatisfaction =
  AgentSignalPolicySignalVariant<'signal.feedback.satisfaction'>;

export type SignalFeedbackDomainMemory =
  AgentSignalPolicySignalVariant<'signal.feedback.domain.memory'>;

export type SignalFeedbackDomainSkill =
  AgentSignalPolicySignalVariant<'signal.feedback.domain.skill'>;

export type SignalFeedbackDomainPrompt =
  AgentSignalPolicySignalVariant<'signal.feedback.domain.prompt'>;

export type SignalFeedbackDomainNone =
  AgentSignalPolicySignalVariant<'signal.feedback.domain.none'>;

/** Server-owned alias for reflect-needed signals. */
export type SignalSelfReflectionNeeded =
  AgentSignalPolicySignalVariant<'signal.self-reflection-analysis.reflect-needed'>;

/** Server-owned alias for reflect-skipped signals. */
export type SignalSelfReflectionSkipped =
  AgentSignalPolicySignalVariant<'signal.self-reflection-analysis.reflect-skipped'>;

/** Server-owned alias for matched memory-nudge signals. */
export type SignalNudgeMemoryConditionMatched =
  AgentSignalPolicySignalVariant<'signal.nudge.memory.condition-matched'>;

/** Server-owned alias for mismatched memory-nudge signals. */
export type SignalNudgeMemoryConditionMismatched =
  AgentSignalPolicySignalVariant<'signal.nudge.memory.condition-mismatched'>;

/** Server-owned alias for memory updates. */
export type ActionUserMemoryHandle = AgentSignalPolicyActionVariant<'action.user-memory.handle'>;

/** Server-owned alias for persona updates. */
export type ActionPersonaHandle = AgentSignalPolicyActionVariant<'action.persona.handle'>;

/** Server-owned alias for skill-management actions. */
export type ActionSkillManagementHandle =
  AgentSignalPolicyActionVariant<'action.skill-management.handle'>;

/** Server-owned alias for memory-nudge actions. */
export type ActionNudgeHandle = AgentSignalPolicyActionVariant<'action.nudge.handle'>;

/** Sources that can trigger the memory-nudge policy. */
export type MemoryNudgePolicySource =
  | SourceAgentExecutionCompleted
  | SourceRuntimeAfterStep
  | SourceRuntimeBeforeStep;

/** Sources that can trigger self-reflection analysis. */
export type SelfReflectionPolicySource = SourceAgentExecutionCompleted | SourceAgentExecutionFailed;
