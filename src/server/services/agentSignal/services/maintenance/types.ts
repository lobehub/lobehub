import type { WriteMaintenanceMemoryInput } from './memory';
import type {
  ConsolidateMaintenanceSkillInput,
  CreateMaintenanceSkillInput,
  RefineMaintenanceSkillInput,
} from './skill';

export enum MaintenanceReviewScope {
  Nightly = 'nightly',
  SelfIterationIntent = 'self_iteration_intent',
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

export type MaintenanceActionType =
  | 'write_memory'
  | 'create_skill'
  | 'refine_skill'
  | 'consolidate_skill'
  | 'noop'
  | 'proposal_only';

export enum MaintenanceApplyMode {
  AutoApply = 'auto_apply',
  ProposalOnly = 'proposal_only',
  Skip = 'skip',
}

export enum MaintenanceRisk {
  High = 'high',
  Low = 'low',
  Medium = 'medium',
}

export enum MaintenanceActionStatus {
  Applied = 'applied',
  Deduped = 'deduped',
  Failed = 'failed',
  Proposed = 'proposed',
  Skipped = 'skipped',
}

export interface EvidenceRef {
  id: string;
  summary?: string;
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

export interface MaintenanceDomainOperationCase<TDomain, TOperation, TInput> {
  domain: TDomain;
  input: TInput;
  operation: TOperation;
}

export type MaintenanceMemoryWriteOperation = MaintenanceDomainOperationCase<
  'memory',
  'write',
  WriteMaintenanceMemoryInput
>;

export type MaintenanceSkillCreateOperation = MaintenanceDomainOperationCase<
  'skill',
  'create',
  CreateMaintenanceSkillInput
>;

export type MaintenanceSkillRefineOperation = MaintenanceDomainOperationCase<
  'skill',
  'refine',
  RefineMaintenanceSkillInput
>;

export type MaintenanceSkillConsolidateOperation = MaintenanceDomainOperationCase<
  'skill',
  'consolidate',
  ConsolidateMaintenanceSkillInput
>;

export type MaintenanceDomainOperation =
  | MaintenanceMemoryWriteOperation
  | MaintenanceSkillConsolidateOperation
  | MaintenanceSkillCreateOperation
  | MaintenanceSkillRefineOperation;

export interface MaintenanceActionTarget {
  memoryId?: string;
  skillDocumentId?: string;
  skillName?: string;
  targetReadonly?: boolean;
  taskIds?: string[];
  topicIds?: string[];
}

export interface MaintenanceReviewFinding {
  evidenceRefs: EvidenceRef[];
  severity: 'high' | 'low' | 'medium';
  summary: string;
}

export interface MaintenanceActionPolicyHints {
  evidenceStrength?: 'medium' | 'strong' | 'weak';
  mutationScope?: 'broad' | 'small';
  persistence?: 'stable' | 'temporal';
  sensitivity?: 'normal' | 'sensitive';
  userExplicitness?: 'explicit' | 'implicit' | 'inferred';
}

export interface MaintenanceActionDraft<TValue = unknown> {
  actionType: MaintenanceActionType;
  confidence: number;
  evidenceRefs: EvidenceRef[];
  policyHints?: MaintenanceActionPolicyHints;
  rationale: string;
  target?: MaintenanceActionTarget;
  value?: TValue;
}

export interface MaintenancePlanDraft {
  actions: MaintenanceActionDraft[];
  findings: MaintenanceReviewFinding[];
  summary: string;
}

export interface MaintenancePlanRequest {
  draft: MaintenancePlanDraft;
  localDate?: string;
  reviewScope: MaintenanceReviewScope;
  sourceId: string;
  userId: string;
}

export interface MaintenanceActionPlan {
  actionType: MaintenanceActionType;
  applyMode: MaintenanceApplyMode;
  confidence: number;
  dedupeKey: string;
  evidenceRefs: EvidenceRef[];
  idempotencyKey: string;
  operation?: MaintenanceDomainOperation;
  rationale: string;
  risk: MaintenanceRisk;
  sourceActionId?: string;
  target?: MaintenanceActionTarget;
}

export interface MaintenancePlan {
  actions: MaintenanceActionPlan[];
  localDate?: string;
  plannerVersion: string;
  reviewScope: MaintenanceReviewScope;
  summary: string;
}

export interface MaintenanceActionResult {
  idempotencyKey: string;
  receiptId?: string;
  resourceId?: string;
  status: MaintenanceActionStatus;
  summary?: string;
}

export interface MaintenanceReviewRunResult {
  actions: MaintenanceActionResult[];
  briefId?: string;
  sourceId?: string;
  status: ReviewRunStatus;
  summaryReceiptId?: string;
}

export interface NightlyReviewSourceIdInput {
  agentId: string;
  localDate: string;
  userId: string;
}

export interface SelfReflectionSourceIdInput {
  agentId: string;
  reason: string;
  scopeId: string;
  scopeType: 'topic' | 'task' | 'operation';
  userId: string;
  windowEnd: string;
  windowStart: string;
}

export interface SelfIterationIntentSourceIdInput {
  agentId: string;
  scopeId: string;
  scopeType: 'operation' | 'topic';
  toolCallId: string;
  userId: string;
}

export interface MaintenanceActionIdempotencyInput {
  actionType: MaintenanceActionType;
  dedupeKey: string;
  sourceId: string;
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
 * Builds the stable source id for one self-reflection trigger window.
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
 * Builds the stable source id for one runtime-declared maintenance intent.
 *
 * Before:
 * - `{ userId: "u", agentId: "a", scopeType: "topic", scopeId: "topic", toolCallId: "call" }`
 *
 * After:
 * - `"self-iteration-intent:u:a:topic:topic:call"`
 */
export const buildSelfIterationIntentSourceId = (input: SelfIterationIntentSourceIdInput) =>
  `self-iteration-intent:${input.userId}:${input.agentId}:${input.scopeType}:${input.scopeId}:${input.toolCallId}`;

/**
 * Builds a replay guard key for one planned maintenance action.
 *
 * Before:
 * - `{ sourceId: "source", actionType: "write_memory", dedupeKey: "memory:abc" }`
 *
 * After:
 * - `"source:write_memory:memory:abc"`
 */
export const buildMaintenanceActionIdempotencyKey = (input: MaintenanceActionIdempotencyInput) =>
  `${input.sourceId}:${input.actionType}:${input.dedupeKey}`;

export const isActionExecutable = (applyMode: MaintenanceApplyMode) =>
  applyMode === MaintenanceApplyMode.AutoApply;
