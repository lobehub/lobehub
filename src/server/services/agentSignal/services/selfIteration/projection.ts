import type { ChatToolPayload } from '@lobechat/types';

import type {
  SelfReviewIdea,
  SelfReviewProposalBaseSnapshot,
  SelfReviewProposalPlan,
} from './review/proposal';
import type { ToolWriteResult } from './tools/shared';
import type {
  ActionPlan,
  ActionStatus as ActionStatusValue,
  ActionTarget,
  RunResult,
  Scope,
} from './types';
import { ActionStatus, ApplyMode, ReviewRunStatus, Risk } from './types';

/** Brief category selected from write-tool outcomes. */
export type SelfReviewBriefKind = 'decision' | 'insight' | 'none';

/** Write-tool result enriched with the tool name that produced it. */
export interface ToolOutcome extends ToolWriteResult {
  /** Stable write-tool name used for brief metadata and diagnostics. */
  toolName: string;
}

/** Input for projecting write-tool outcomes to Daily Brief metadata. */
export interface ProjectOutcomesInput {
  /** Terminal write-tool outcomes collected from one runtime turn. */
  outcomes: ToolOutcome[];
}

/** Input for projecting a complete tool-first runtime result into legacy brief contracts. */
export interface ProjectRunInput extends ProjectOutcomesInput {
  /** Assistant summary emitted by the tool-first runtime. */
  content?: string;
  /** Whether proposal lifecycle tool calls should project embedded resource actions. */
  includeProposalLifecycleActions?: boolean;
  /** User-local nightly date used in the projected self-iteration plan. */
  localDate?: string;
  /** Review scope attached to the projected self-iteration plan. */
  reviewScope: Scope;
  /** Stable source id used for idempotency-key fallbacks. */
  sourceId: string;
  /** Tool calls captured by the runtime in execution order. */
  toolCalls: ChatToolPayload[];
  /** Stable user id owning this run. */
  userId: string;
}

/** Legacy contracts projected from a tool-first runtime run. */
export interface ProjectedRun {
  /** Executor-shaped result consumed by receipt and brief projection. */
  execution: RunResult;
  /** Non-actionable ideas extracted from proposal-only actions. */
  ideas: SelfReviewIdea[];
  /** Plan-shaped projection consumed by Daily Brief proposal metadata. */
  projectionPlan: SelfReviewProposalPlan;
}

/** Per-status counts retained in brief-compatible metadata. */
export interface ProjectedOutcomeCounts {
  /** Number of write tools that mutated durable state. */
  applied: number;
  /** Number of write tools that failed. */
  failed: number;
  /** Number of user-visible proposal writes. */
  proposed: number;
  /** Number of write tools skipped or deduped without mutation. */
  skipped: number;
}

/** Brief-compatible metadata projected from write-tool outcomes. */
export interface ProjectedOutcomes {
  /** Per-status counts used by brief copy and filtering. */
  actionCounts: ProjectedOutcomeCounts;
  /** Bounded write-tool action fields safe to retain in brief metadata. */
  actions: ToolOutcome[];
  /** Coarse brief kind selected from visible write-tool outcomes. */
  briefKind: SelfReviewBriefKind;
  /** Number of proposed write outcomes that should request a decision brief. */
  proposalCount: number;
  /** Durable receipt ids linked to the projected outcomes. */
  receiptIds: string[];
}

const PROPOSAL_LIFECYCLE_TOOL_NAMES = new Set([
  'closeSelfReviewProposal',
  'createSelfReviewProposal',
  'refreshSelfReviewProposal',
  'supersedeSelfReviewProposal',
]);

const normalizeProjectionToolName = (toolName: string) => {
  if (toolName === 'closeSelfReviewProposal') return 'closeSelfReviewProposal';
  if (toolName === 'createSelfReviewProposal') return 'createSelfReviewProposal';
  if (toolName === 'refreshSelfReviewProposal') return 'refreshSelfReviewProposal';
  if (toolName === 'supersedeSelfReviewProposal') return 'supersedeSelfReviewProposal';

  return toolName;
};

const isProposalLifecycleTool = (toolName: string) => PROPOSAL_LIFECYCLE_TOOL_NAMES.has(toolName);

/**
 * Normalizes one write-tool outcome to bounded brief action metadata.
 *
 * Before:
 * - `{ toolName: "writeMemory", status: "applied", receiptId: undefined }`
 *
 * After:
 * - `{ toolName: "writeMemory", status: "applied" }`
 */
const projectAction = (outcome: ToolOutcome): ToolOutcome => ({
  ...(outcome.receiptId === undefined ? {} : { receiptId: outcome.receiptId }),
  ...(outcome.resourceId === undefined ? {} : { resourceId: outcome.resourceId }),
  status: outcome.status,
  ...(outcome.summary === undefined ? {} : { summary: outcome.summary }),
  toolName: outcome.toolName,
});

/**
 * Projects shared write-tool outcomes into brief-compatible metadata.
 *
 * Use when:
 * - Self-review tools need a compact Daily Brief projection
 * - Tool outcomes should be classified as decision, insight, or silent metadata
 *
 * Expects:
 * - Outcomes are already bounded by write-tool result contracts
 * - Proposal lifecycle tools are silent resource-wise unless their embedded action payload is projected elsewhere
 *
 * Returns:
 * - Counts, receipt ids, bounded actions, and the selected brief kind
 */
export const projectOutcomes = (input: ProjectOutcomesInput): ProjectedOutcomes => {
  const actionCounts: ProjectedOutcomeCounts = {
    applied: 0,
    failed: 0,
    proposed: 0,
    skipped: 0,
  };
  const receiptIds: string[] = [];

  for (const outcome of input.outcomes) {
    if (outcome.receiptId !== undefined) receiptIds.push(outcome.receiptId);

    const isLifecycleOutcome = isProposalLifecycleTool(outcome.toolName);

    if (outcome.status === 'applied') actionCounts.applied += 1;
    if (outcome.status === 'failed') actionCounts.failed += 1;
    if (outcome.status === 'proposed' && !isLifecycleOutcome) actionCounts.proposed += 1;
    if (
      outcome.status === 'deduped' ||
      outcome.status === 'skipped_stale' ||
      outcome.status === 'skipped_unsupported'
    ) {
      actionCounts.skipped += 1;
    }
  }

  const proposalCount = 0;
  const hasVisibleRiskOutcome = input.outcomes.some(
    (outcome) => outcome.status === 'failed' || outcome.status === 'skipped_stale',
  );
  const briefKind: SelfReviewBriefKind =
    proposalCount > 0
      ? 'decision'
      : actionCounts.applied > 0 || hasVisibleRiskOutcome
        ? 'insight'
        : 'none';

  return {
    actionCounts,
    actions: input.outcomes.map(projectAction),
    briefKind,
    proposalCount,
    receiptIds,
  };
};

const WRITE_TOOL_NAMES = new Set([
  'closeSelfReviewProposal',
  'closeSelfReviewProposal',
  'createSelfReviewProposal',
  'createSelfReviewProposal',
  'createSkillIfAbsent',
  'refreshSelfReviewProposal',
  'refreshSelfReviewProposal',
  'replaceSkillContentCAS',
  'supersedeSelfReviewProposal',
  'supersedeSelfReviewProposal',
  'writeMemory',
]);

const parseToolArguments = (value: string | undefined): Record<string, unknown> => {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const getString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const getBoolean = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

const getStringArray = (value: unknown) =>
  Array.isArray(value) ? value.flatMap((item) => (getString(item) ? [getString(item)!] : [])) : [];

const getRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getBaseSnapshot = (value: unknown): SelfReviewProposalBaseSnapshot | undefined => {
  const record = getRecord(value);
  if (Object.keys(record).length === 0) return;

  return {
    absent: getBoolean(record.absent),
    agentDocumentId: getString(record.agentDocumentId),
    contentHash: getString(record.contentHash),
    documentId: getString(record.documentId),
    documentUpdatedAt: getString(record.documentUpdatedAt),
    managed: getBoolean(record.managed),
    skillName: getString(record.skillName),
    targetTitle: getString(record.targetTitle),
    targetType: record.targetType === 'skill' ? 'skill' : undefined,
    writable: getBoolean(record.writable),
  };
};

const getBaseSnapshots = (value: unknown): SelfReviewProposalBaseSnapshot[] =>
  Array.isArray(value) ? value.flatMap((item) => getBaseSnapshot(item) ?? []) : [];

const toActionStatus = (status: ToolWriteResult['status']): ActionStatusValue => {
  if (status === 'applied') return ActionStatus.Applied;
  if (status === 'deduped') return ActionStatus.Deduped;
  if (status === 'failed') return ActionStatus.Failed;
  if (status === 'proposed') return ActionStatus.Proposed;

  return ActionStatus.Skipped;
};

const getRunStatus = (actions: RunResult['actions']): ReviewRunStatus => {
  if (actions.length === 0) return ReviewRunStatus.Skipped;

  const failedCount = actions.filter((action) => action.status === ActionStatus.Failed).length;
  const successfulCount = actions.filter(
    (action) => action.status === ActionStatus.Applied || action.status === ActionStatus.Proposed,
  ).length;

  if (failedCount > 0 && successfulCount > 0) return ReviewRunStatus.PartiallyApplied;
  if (failedCount > 0) return ReviewRunStatus.Failed;
  if (successfulCount === 0) return ReviewRunStatus.Skipped;

  return ReviewRunStatus.Completed;
};

const getActionType = (toolName: string): ActionPlan['actionType'] => {
  const normalizedToolName = normalizeProjectionToolName(toolName);

  if (normalizedToolName === 'writeMemory') return 'write_memory';
  if (normalizedToolName === 'createSkillIfAbsent') return 'create_skill';
  if (normalizedToolName === 'replaceSkillContentCAS') return 'refine_skill';

  return 'proposal_only';
};

const getWriteToolCalls = (toolCalls: ChatToolPayload[]) =>
  toolCalls.filter((toolCall) => WRITE_TOOL_NAMES.has(toolCall.apiName));

const getToolCallForOutcome = (
  writeToolCalls: ChatToolPayload[],
  outcome: ToolOutcome,
  cursors: Map<string, number>,
) => {
  const startIndex = cursors.get(outcome.toolName) ?? 0;
  const matchingIndex = writeToolCalls.findIndex(
    (toolCall, index) =>
      index >= startIndex &&
      normalizeProjectionToolName(toolCall.apiName) ===
        normalizeProjectionToolName(outcome.toolName),
  );

  if (matchingIndex === -1) return;

  cursors.set(outcome.toolName, matchingIndex + 1);

  return writeToolCalls[matchingIndex];
};

const getIdempotencyKey = ({
  args,
  sourceId,
  toolCall,
  toolName,
}: {
  args: Record<string, unknown>;
  sourceId: string;
  toolCall?: ChatToolPayload;
  toolName: string;
}) =>
  getString(args.idempotencyKey) ??
  outcomeFallbackIdempotencyKey({
    sourceId,
    toolCallId: toolCall?.id,
    toolName,
  });

const outcomeFallbackIdempotencyKey = ({
  sourceId,
  toolCallId,
  toolName,
}: {
  sourceId: string;
  toolCallId?: string;
  toolName: string;
}) => `${sourceId}:${toolName}:${toolCallId ?? 'tool-outcome'}`;

const getSkillCreateOperation = (args: Record<string, unknown>, userId: string) => ({
  domain: 'skill' as const,
  input: {
    bodyMarkdown: getString(args.bodyMarkdown),
    description: getString(args.description),
    name: getString(args.name),
    title: getString(args.title),
    userId,
  },
  operation: 'create' as const,
});

const getMemoryWriteOperation = (args: Record<string, unknown>, userId: string) => {
  const content = getString(args.content);
  if (!content) return;

  return {
    domain: 'memory' as const,
    input: { content, userId },
    operation: 'write' as const,
  };
};

const getSkillRefineOperation = (args: Record<string, unknown>, userId: string) => {
  const skillDocumentId = getString(args.skillDocumentId);
  if (!skillDocumentId) return;

  return {
    domain: 'skill' as const,
    input: {
      bodyMarkdown: getString(args.bodyMarkdown),
      description: getString(args.description),
      skillDocumentId,
      userId,
    },
    operation: 'refine' as const,
  };
};

const toEvidenceRefs = (value: unknown): ActionPlan['evidenceRefs'] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = getRecord(item);
        const id = getString(record.id);
        const type = getString(record.type);

        return id && type ? [{ id, type: type as ActionPlan['evidenceRefs'][number]['type'] }] : [];
      })
    : [];

const toTarget = (value: unknown): ActionTarget | undefined => {
  const record = getRecord(value);
  const memoryId = getString(record.memoryId);
  const skillDocumentId = getString(record.skillDocumentId);
  const skillName = getString(record.skillName);
  const targetReadonly = getBoolean(record.targetReadonly);

  if (!memoryId && !skillDocumentId && !skillName && targetReadonly === undefined) return;

  return {
    ...(memoryId ? { memoryId } : {}),
    ...(skillDocumentId ? { skillDocumentId } : {}),
    ...(skillName ? { skillName } : {}),
    ...(targetReadonly === undefined ? {} : { targetReadonly }),
  };
};

const toRisk = (value: unknown) => {
  if (value === Risk.High) return Risk.High;
  if (value === Risk.Medium) return Risk.Medium;

  return Risk.Low;
};

const toApplyMode = (value: unknown, outcome: ToolOutcome) => {
  if (value === ApplyMode.AutoApply) return ApplyMode.AutoApply;
  if (value === ApplyMode.Skip) return ApplyMode.Skip;
  if (value === ApplyMode.ProposalOnly) return ApplyMode.ProposalOnly;

  return outcome.status === 'proposed' ? ApplyMode.ProposalOnly : ApplyMode.AutoApply;
};

const toConfidence = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;

const toSkillOperation = (value: unknown, userId: string): ActionPlan['operation'] => {
  const record = getRecord(value);
  if (record.domain !== 'skill') return;

  const input = getRecord(record.input);

  if (record.operation === 'create') {
    return {
      domain: 'skill',
      input: {
        bodyMarkdown: getString(input.bodyMarkdown),
        description: getString(input.description),
        name: getString(input.name),
        title: getString(input.title),
        userId: getString(input.userId) ?? userId,
      },
      operation: 'create',
    };
  }

  if (record.operation === 'refine') {
    const skillDocumentId = getString(input.skillDocumentId);
    if (!skillDocumentId) return;

    return {
      domain: 'skill',
      input: {
        bodyMarkdown: getString(input.bodyMarkdown),
        patch: getString(input.patch),
        skillDocumentId,
        userId: getString(input.userId) ?? userId,
      },
      operation: 'refine',
    };
  }

  if (record.operation === 'consolidate') {
    const canonicalSkillDocumentId = getString(input.canonicalSkillDocumentId);
    const sourceSkillIds = getStringArray(input.sourceSkillIds);
    if (!canonicalSkillDocumentId || sourceSkillIds.length === 0) return;

    return {
      domain: 'skill',
      input: {
        approval: { source: 'proposal' },
        bodyMarkdown: getString(input.bodyMarkdown),
        canonicalSkillDocumentId,
        description: getString(input.description),
        sourceSkillIds,
        sourceSnapshots: getBaseSnapshots(input.sourceSnapshots),
        userId: getString(input.userId) ?? userId,
      },
      operation: 'consolidate',
    };
  }
};

const getRawActionType = (value: unknown): ActionPlan['actionType'] | undefined => {
  if (
    value === 'write_memory' ||
    value === 'create_skill' ||
    value === 'refine_skill' ||
    value === 'consolidate_skill' ||
    value === 'noop' ||
    value === 'proposal_only'
  ) {
    return value;
  }
};

const getCompleteBaseSnapshot = ({
  actionType,
  baseSnapshot,
  operation,
  target,
}: {
  actionType: ActionPlan['actionType'];
  baseSnapshot: SelfReviewProposalBaseSnapshot | undefined;
  operation: ActionPlan['operation'];
  target: ActionTarget | undefined;
}): SelfReviewProposalBaseSnapshot | undefined => {
  if (actionType === 'create_skill') {
    return {
      absent: true,
      ...baseSnapshot,
      skillName:
        baseSnapshot?.skillName ??
        target?.skillName ??
        (operation?.domain === 'skill' && operation.operation === 'create'
          ? operation.input.name
          : undefined),
      targetType: 'skill',
    };
  }

  if (actionType === 'refine_skill') return baseSnapshot;

  return baseSnapshot;
};

const getProjectionActionFromRaw = ({
  fallbackIdempotencyKey,
  index,
  outcome,
  rawAction,
  userId,
}: {
  fallbackIdempotencyKey: string;
  index: number;
  outcome: ToolOutcome;
  rawAction: unknown;
  userId: string;
}): SelfReviewProposalPlan['actions'][number] | undefined => {
  const record = getRecord(rawAction);
  const actionType = getRawActionType(record.actionType);
  const idempotencyKey =
    getString(record.idempotencyKey) ?? `${fallbackIdempotencyKey}:action:${index + 1}`;

  if (!actionType || actionType === 'proposal_only') return;

  const operation = toSkillOperation(record.operation, userId);
  const target = toTarget(record.target);
  const baseSnapshot = getCompleteBaseSnapshot({
    actionType,
    baseSnapshot: getBaseSnapshot(record.baseSnapshot),
    operation,
    target,
  });
  const baseAction = {
    applyMode: toApplyMode(record.applyMode, outcome),
    confidence: toConfidence(record.confidence),
    dedupeKey:
      getString(record.dedupeKey) ??
      (target?.skillDocumentId
        ? `skill:${target.skillDocumentId}`
        : target?.skillName
          ? `skill:${target.skillName}`
          : target?.memoryId
            ? `memory:${target.memoryId}`
            : actionType),
    evidenceRefs: toEvidenceRefs(record.evidenceRefs),
    idempotencyKey,
    rationale: getString(record.rationale) ?? outcome.summary ?? 'Self-review proposal action.',
    risk: toRisk(record.risk),
    ...(operation ? { operation } : {}),
    ...(target ? { target } : {}),
  };

  if (actionType === 'create_skill') {
    return {
      ...baseAction,
      actionType,
      baseSnapshot: baseSnapshot ?? { absent: true, targetType: 'skill' },
    };
  }

  if (actionType === 'write_memory') {
    return {
      ...baseAction,
      actionType,
      evidenceRefs: toEvidenceRefs(record.evidenceRefs),
      ...(getMemoryWriteOperation(record, userId)
        ? { operation: getMemoryWriteOperation(record, userId) }
        : {}),
    };
  }

  if (actionType === 'refine_skill') {
    if (!baseSnapshot) return;

    return {
      ...baseAction,
      actionType,
      baseSnapshot,
    };
  }

  return {
    ...baseAction,
    actionType,
    ...(baseSnapshot ? { baseSnapshot } : {}),
  };
};

const getIdeaFromRaw = ({
  fallbackIdempotencyKey,
  index,
  rawAction,
}: {
  fallbackIdempotencyKey: string;
  index: number;
  rawAction: unknown;
}): SelfReviewIdea | undefined => {
  const record = getRecord(rawAction);
  if (getRawActionType(record.actionType) !== 'proposal_only') return;

  const target = toTarget(record.target);

  return {
    evidenceRefs: toEvidenceRefs(record.evidenceRefs),
    idempotencyKey:
      getString(record.idempotencyKey) ?? `${fallbackIdempotencyKey}:idea:${index + 1}`,
    rationale: getString(record.rationale) ?? 'SelfIteration self-review idea.',
    risk: toRisk(record.risk),
    ...(target ? { target } : {}),
    ...(getString(record.title) ? { title: getString(record.title) } : {}),
  };
};

const getProjectionPayloadFromProposalArgs = ({
  args,
  idempotencyKey,
  outcome,
  userId,
}: {
  args: Record<string, unknown>;
  idempotencyKey: string;
  outcome: ToolOutcome;
  userId: string;
}): { actions: SelfReviewProposalPlan['actions']; ideas: SelfReviewIdea[] } => {
  const actions: SelfReviewProposalPlan['actions'] = [];
  const ideas: SelfReviewIdea[] = [];

  if (Array.isArray(args.actions)) {
    for (const [index, rawAction] of args.actions.entries()) {
      const idea = getIdeaFromRaw({
        fallbackIdempotencyKey: idempotencyKey,
        index,
        rawAction,
      });

      if (idea) {
        ideas.push(idea);
        continue;
      }

      const action = getProjectionActionFromRaw({
        fallbackIdempotencyKey: idempotencyKey,
        index,
        outcome,
        rawAction,
        userId,
      });

      if (action) actions.push(action);
    }
  }

  return { actions, ideas };
};

const getProjectionAction = ({
  args,
  idempotencyKey,
  outcome,
  toolName,
  userId,
}: {
  args: Record<string, unknown>;
  idempotencyKey: string;
  outcome: ToolOutcome;
  toolName: string;
  userId: string;
}): SelfReviewProposalPlan['actions'][number] => {
  const actionType = getActionType(toolName);
  const skillDocumentId = getString(args.skillDocumentId) ?? outcome.resourceId;
  const skillName = getString(args.name);
  const baseSnapshot = getBaseSnapshot(args.baseSnapshot);
  const baseAction = {
    applyMode: outcome.status === 'proposed' ? ApplyMode.ProposalOnly : ApplyMode.AutoApply,
    confidence: 1,
    dedupeKey: getString(args.proposalKey) ?? outcome.resourceId ?? idempotencyKey,
    evidenceRefs: [],
    idempotencyKey,
    rationale: outcome.summary ?? 'Self-review tool write outcome.',
    risk: outcome.status === 'failed' ? Risk.Medium : Risk.Low,
    ...(skillDocumentId || skillName
      ? {
          target: {
            ...(skillDocumentId ? { skillDocumentId } : {}),
            ...(skillName ? { skillName } : {}),
          },
        }
      : {}),
  };

  if (actionType === 'create_skill') {
    return {
      ...baseAction,
      actionType,
      baseSnapshot: baseSnapshot ?? {
        absent: true,
        ...(skillName ? { skillName } : {}),
        targetType: 'skill',
      },
      operation: getSkillCreateOperation(args, userId),
    };
  }

  if (actionType === 'refine_skill') {
    return {
      ...baseAction,
      actionType,
      baseSnapshot: baseSnapshot ?? {
        ...(skillDocumentId ? { agentDocumentId: skillDocumentId } : {}),
        managed: true,
        targetType: 'skill',
        writable: true,
      },
      ...(getSkillRefineOperation(args, userId)
        ? { operation: getSkillRefineOperation(args, userId) }
        : {}),
    };
  }

  return {
    ...baseAction,
    actionType,
    ...(baseSnapshot ? { baseSnapshot } : {}),
  };
};

/**
 * Projects a tool-first runtime run into legacy execution and proposal contracts.
 *
 * Use when:
 * - The nightly server runtime has write-tool outcomes instead of executor results
 * - Daily Brief projection still expects `RunResult` and `SelfReviewProposalPlan`
 *
 * Expects:
 * - Runtime write outcomes and write tool calls are in execution order
 * - Tool write results have already passed safe mutation boundaries
 *
 * Returns:
 * - A completed/skipped/failed execution result plus a plan containing only confirmed tool writes
 */
export const projectRun = (input: ProjectRunInput): ProjectedRun => {
  const writeToolCalls = getWriteToolCalls(input.toolCalls);
  const ideas: SelfReviewIdea[] = [];
  const projectionActions: SelfReviewProposalPlan['actions'] = [];
  const executionActions: RunResult['actions'] = [];
  const toolCallCursors = new Map<string, number>();

  for (const outcome of input.outcomes) {
    const toolCall = getToolCallForOutcome(writeToolCalls, outcome, toolCallCursors);
    const args = parseToolArguments(toolCall?.arguments);
    const idempotencyKey = getIdempotencyKey({
      args,
      sourceId: input.sourceId,
      toolCall,
      toolName: outcome.toolName,
    });
    const proposalPayload =
      input.includeProposalLifecycleActions && isProposalLifecycleTool(outcome.toolName)
        ? getProjectionPayloadFromProposalArgs({
            args,
            idempotencyKey,
            outcome,
            userId: input.userId,
          })
        : { actions: [], ideas: [] };

    if (isProposalLifecycleTool(outcome.toolName)) {
      if (proposalPayload.ideas.length > 0) {
        ideas.push(...proposalPayload.ideas);
      }

      if (proposalPayload.actions.length > 0) {
        projectionActions.push(...proposalPayload.actions);
        executionActions.push(
          ...proposalPayload.actions.map((action) => ({
            idempotencyKey: action.idempotencyKey,
            ...(outcome.receiptId ? { receiptId: outcome.receiptId } : {}),
            ...(outcome.resourceId ? { resourceId: outcome.resourceId } : {}),
            status: toActionStatus(outcome.status),
            ...(outcome.summary ? { summary: outcome.summary } : {}),
          })),
        );
        continue;
      }

      if (input.includeProposalLifecycleActions && proposalPayload.ideas.length > 0) {
        executionActions.push({
          idempotencyKey,
          ...(outcome.receiptId ? { receiptId: outcome.receiptId } : {}),
          ...(outcome.resourceId ? { resourceId: outcome.resourceId } : {}),
          status: ActionStatus.Skipped,
          summary: outcome.summary ?? 'Self-review proposal created self-review ideas.',
        });
      }
      continue;
    }

    projectionActions.push(
      getProjectionAction({
        args,
        idempotencyKey,
        outcome,
        toolName: outcome.toolName,
        userId: input.userId,
      }),
    );
    executionActions.push({
      idempotencyKey,
      ...(outcome.receiptId ? { receiptId: outcome.receiptId } : {}),
      ...(outcome.resourceId ? { resourceId: outcome.resourceId } : {}),
      status: toActionStatus(outcome.status),
      ...(outcome.summary ? { summary: outcome.summary } : {}),
    });
  }

  const projectionPlan: SelfReviewProposalPlan = {
    actions: projectionActions,
    ...(input.localDate ? { localDate: input.localDate } : {}),
    plannerVersion: 'shared-tool-first-runtime-v1',
    reviewScope: input.reviewScope,
    summary: input.content?.trim() || 'Self-review tool-first runtime completed.',
  };
  const execution: RunResult = {
    actions: executionActions,
    sourceId: input.sourceId,
    status: getRunStatus(executionActions),
  };

  return { execution, ideas, projectionPlan };
};
