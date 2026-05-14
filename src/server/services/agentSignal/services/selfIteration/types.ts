import type {
  MemoryWriteInput,
  SkillConsolidateInput,
  SkillCreateInput,
  SkillRefineInput,
} from './tools/shared';

/**
 * Evidence reference persisted in self-iteration plans, ideas, receipts, and brief artifacts.
 */
export interface EvidenceRef {
  /** Stable evidence id in its source domain. */
  id: string;
  /** Optional short reason this evidence matters. */
  summary?: string;
  /** Domain that owns the evidence id. */
  type:
    | 'topic'
    | 'message'
    | 'operation'
    | 'source'
    | 'receipt'
    | 'tool_call'
    | 'task'
    | 'agent_document'
    | 'memory';
}

/**
 * Input for a stable nightly self-review source id.
 */
export interface NightlyReviewSourceIdInput {
  /** Agent reviewed in the local nightly window. */
  agentId: string;
  /** Local date represented as `YYYY-MM-DD`. */
  localDate: string;
  /** User that owns the reviewed agent. */
  userId: string;
}

/**
 * Input for a stable immediate self-reflection source id.
 */
export interface SelfReflectionSourceIdInput {
  /** Agent associated with the weak-signal trigger. */
  agentId: string;
  /** Trigger reason emitted by the accumulator or caller. */
  reason: string;
  /** Scoped id selected for the reflection window. */
  scopeId: string;
  /** Scope family selected for the reflection window. */
  scopeType: 'topic' | 'task' | 'operation';
  /** User that owns the reflected agent. */
  userId: string;
  /** ISO timestamp for the end of the reflection window. */
  windowEnd: string;
  /** ISO timestamp for the beginning of the reflection window. */
  windowStart: string;
}

/**
 * Input for a stable agent-declared self-feedback intent source id.
 */
export interface SelfFeedbackIntentSourceIdInput {
  /** Agent that declared the intent. */
  agentId: string;
  /** Scope id selected from operation or topic context. */
  scopeId: string;
  /** Scope family selected for the declaration. */
  scopeType: 'operation' | 'topic';
  /** Tool call id that declared the intent. */
  toolCallId: string;
  /** User that owns the declaring agent. */
  userId: string;
}

/**
 * Builds the stable source id for one user-agent local nightly review.
 *
 * Before:
 * - `{ userId: "u", agentId: "a", localDate: "2026-05-04" }`
 *
 * After:
 * - `"nightly-review:u:a:2026-05-04"`
 */
export const buildNightlyReviewSourceId = (input: NightlyReviewSourceIdInput) =>
  `nightly-review:${input.userId}:${input.agentId}:${input.localDate}`;

/**
 * Builds the stable source id for one immediate self-reflection trigger window.
 *
 * Before:
 * - `{ userId: "u", agentId: "a", scopeType: "task", scopeId: "t", reason: "failed", windowStart: "start", windowEnd: "end" }`
 *
 * After:
 * - `"self-reflection:u:a:task:t:failed:start:end"`
 */
export const buildSelfReflectionSourceId = (input: SelfReflectionSourceIdInput) =>
  [
    'self-reflection',
    input.userId,
    input.agentId,
    input.scopeType,
    input.scopeId,
    input.reason,
    input.windowStart,
    input.windowEnd,
  ].join(':');

/**
 * Builds the stable source id for one runtime-declared self-feedback intent.
 *
 * Before:
 * - `{ userId: "u", agentId: "a", scopeType: "topic", scopeId: "topic", toolCallId: "call" }`
 *
 * After:
 * - `"self-feedback-intent:u:a:topic:topic:call"`
 */
export const buildSelfFeedbackIntentSourceId = (input: SelfFeedbackIntentSourceIdInput) =>
  `self-feedback-intent:${input.userId}:${input.agentId}:${input.scopeType}:${input.scopeId}:${input.toolCallId}`;

export enum Scope {
  Nightly = 'nightly',
  SelfFeedback = 'self_feedback',
  SelfReflection = 'self_reflection',
}

export enum ReviewRunStatus {
  Collected = 'collected',
  Completed = 'completed',
  Deduped = 'deduped',
  Failed = 'failed',
  PartiallyApplied = 'partially_applied',
  Planned = 'planned',
  Skipped = 'skipped',
}

export type ActionType =
  | 'write_memory'
  | 'create_skill'
  | 'refine_skill'
  | 'consolidate_skill'
  | 'noop'
  | 'proposal_only';

export enum ApplyMode {
  AutoApply = 'auto_apply',
  ProposalOnly = 'proposal_only',
  Skip = 'skip',
}

export enum Risk {
  High = 'high',
  Low = 'low',
  Medium = 'medium',
}

export enum ActionStatus {
  Applied = 'applied',
  Deduped = 'deduped',
  Failed = 'failed',
  Proposed = 'proposed',
  Skipped = 'skipped',
}

export interface DomainOperationCase<TDomain, TOperation, TInput> {
  domain: TDomain;
  input: TInput;
  operation: TOperation;
}

export type MemoryWriteOperation = DomainOperationCase<'memory', 'write', MemoryWriteInput>;

export type SkillCreateOperation = DomainOperationCase<'skill', 'create', SkillCreateInput>;

export type SkillRefineOperation = DomainOperationCase<'skill', 'refine', SkillRefineInput>;

export type SkillConsolidateOperation = DomainOperationCase<
  'skill',
  'consolidate',
  SkillConsolidateInput
>;

export type DomainOperation =
  | MemoryWriteOperation
  | SkillConsolidateOperation
  | SkillCreateOperation
  | SkillRefineOperation;

export interface ActionTarget {
  memoryId?: string;
  skillDocumentId?: string;
  skillName?: string;
  targetReadonly?: boolean;
  taskIds?: string[];
  topicIds?: string[];
}

export interface ActionPlan {
  actionType: ActionType;
  applyMode: ApplyMode;
  confidence: number;
  dedupeKey: string;
  evidenceRefs: EvidenceRef[];
  idempotencyKey: string;
  operation?: DomainOperation;
  rationale: string;
  risk: Risk;
  sourceActionId?: string;
  target?: ActionTarget;
}

export interface Plan {
  actions: ActionPlan[];
  localDate?: string;
  plannerVersion: string;
  reviewScope: Scope;
  summary: string;
}

export interface ActionResult {
  idempotencyKey: string;
  receiptId?: string;
  resourceId?: string;
  status: ActionStatus;
  summary?: string;
}

export interface RunResult {
  actions: ActionResult[];
  briefId?: string;
  sourceId?: string;
  status: ReviewRunStatus;
  summaryReceiptId?: string;
}

export interface ActionIdempotencyInput {
  actionType: ActionType;
  dedupeKey: string;
  sourceId: string;
}

/**
 * Builds a replay guard key for one planned self-review action.
 *
 * Before:
 * - `{ sourceId: "source", actionType: "write_memory", dedupeKey: "memory:abc" }`
 *
 * After:
 * - `"source:write_memory:memory:abc"`
 */
export const buildActionIdempotencyKey = (input: ActionIdempotencyInput) =>
  `${input.sourceId}:${input.actionType}:${input.dedupeKey}`;

export const isActionExecutable = (applyMode: ApplyMode) => applyMode === ApplyMode.AutoApply;

/**
 * Self-iteration execution mode.
 */
export type IterationMode = 'feedback' | 'reflection' | 'review';

/**
 * Stable status values emitted by shared runs.
 */
export enum RunStatus {
  Collected = 'collected',
  Completed = 'completed',
  Deduped = 'deduped',
  Failed = 'failed',
  PartiallyApplied = 'partially_applied',
  Planned = 'planned',
  Skipped = 'skipped',
}

/**
 * Evidence window used by review, reflection, and intent runs.
 */
export interface IterationWindow {
  /** End of the evidence window as an ISO timestamp. */
  end: string;
  /** Local review date for nightly review runs. */
  localDate?: string;
  /** Start of the evidence window as an ISO timestamp. */
  start: string;
  /** User timezone used to derive local review dates. */
  timezone?: string;
}

/**
 * Explicit shared target shape persisted in brief and receipt metadata.
 */
export interface IterationTarget {
  /** Stable user memory id when the idea targets one existing memory. */
  memoryId?: string;
  /** True when the target must never direct-apply. */
  readonly?: boolean;
  /** Agent document binding id for managed skills. */
  skillDocumentId?: string;
  /** Stable managed skill name when the binding id is not known yet. */
  skillName?: string;
  /** Task ids that contributed evidence. */
  taskIds?: string[];
  /** Topic ids that contributed evidence. */
  topicIds?: string[];
}

/**
 * A non-executable shared idea preserved for later review.
 */
export interface Idea {
  /** Evidence references that justify keeping the idea. */
  evidenceRefs: EvidenceRef[];
  /** Stable dedupe key for this idea. */
  idempotencyKey: string;
  /** Why the idea exists. */
  rationale: string;
  /** Risk if this idea became a mutation later. */
  risk: 'high' | 'low' | 'medium';
  /** Optional target this idea is about. */
  target?: IterationTarget;
  /** Optional short label for UI/artifact presentation. */
  title?: string;
}

/**
 * Programmatic resource operation that a self-feedback intent may carry.
 */
export type SelfFeedbackIntentOperation =
  | {
      domain: 'memory';
      input: { content: string; userId: string };
      operation: 'write';
    }
  | {
      domain: 'skill';
      input: {
        bodyMarkdown?: string;
        description?: string;
        name?: string;
        title?: string;
        userId: string;
      };
      operation: 'create';
    }
  | {
      domain: 'skill';
      input: {
        bodyMarkdown: string;
        description?: string;
        skillDocumentId: string;
        userId: string;
      };
      operation: 'refine';
    }
  | {
      domain: 'skill';
      input: {
        bodyMarkdown?: string;
        canonicalSkillDocumentId: string;
        description?: string;
        sourceSkillIds: string[];
        userId: string;
      };
      operation: 'consolidate';
    };

/**
 * Agent-authored immediate feedback intent stored in receipt metadata.
 */
export interface SelfFeedbackIntent extends Idea {
  /** Optional self-review action hint used when a reviewer later promotes the intent. */
  actionType?: string;
  /** Normalized confidence from 0 to 1. */
  confidence: number;
  /** Why this intent was downgraded instead of directly executable. */
  downgradeReason?: 'approval_required' | 'low_confidence' | 'unsupported_in_reflection';
  /** Resource class this intent is about. */
  intentType: 'memory' | 'skill' | 'tooling' | 'workflow';
  /** Immediate intents are reflection-mode output, not nightly review output. */
  mode: 'reflection';
  /** Optional executable operation after validation. */
  operation?: SelfFeedbackIntentOperation;
  /** How soon the agent should revisit this intent. */
  urgency: 'immediate' | 'later' | 'soon';
}
