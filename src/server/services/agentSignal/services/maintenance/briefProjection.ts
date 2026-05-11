import type { ChatToolPayload } from '@lobechat/types';

import type { MaintenanceProposalBaseSnapshot, MaintenanceProposalPlan } from './proposal';
import type { MaintenanceToolWriteResult } from './tools';
import type {
  MaintenanceActionPlan,
  MaintenanceActionStatus as MaintenanceActionStatusValue,
  MaintenanceActionTarget,
  MaintenanceReviewRunResult,
  MaintenanceReviewScope,
} from './types';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceRisk,
  ReviewRunStatus,
} from './types';

/** Brief category selected from maintenance write-tool outcomes. */
export type MaintenanceBriefKind = 'decision' | 'insight' | 'none';

/** Write-tool result enriched with the tool name that produced it. */
export interface MaintenanceToolOutcome extends MaintenanceToolWriteResult {
  /** Stable write-tool name used for brief metadata and diagnostics. */
  toolName: string;
}

/** Input for projecting maintenance write-tool outcomes to Daily Brief metadata. */
export interface ProjectMaintenanceToolOutcomesInput {
  /** Terminal write-tool outcomes collected from one maintenance turn. */
  outcomes: MaintenanceToolOutcome[];
}

/** Input for projecting a complete tool-first runtime result into legacy brief contracts. */
export interface ProjectMaintenanceToolRuntimeRunInput extends ProjectMaintenanceToolOutcomesInput {
  /** Assistant summary emitted by the tool-first runtime. */
  content?: string;
  /** User-local nightly date used in the projected maintenance plan. */
  localDate?: string;
  /** Review scope attached to the projected maintenance plan. */
  reviewScope: MaintenanceReviewScope;
  /** Stable source id used for idempotency-key fallbacks. */
  sourceId: string;
  /** Tool calls captured by the runtime in execution order. */
  toolCalls: ChatToolPayload[];
  /** Stable user id owning this run. */
  userId: string;
}

/** Legacy contracts projected from a tool-first runtime run. */
export interface ProjectedMaintenanceToolRuntimeRun {
  /** Executor-shaped result consumed by receipt and brief projection. */
  execution: MaintenanceReviewRunResult;
  /** Plan-shaped projection consumed by Daily Brief proposal metadata. */
  projectionPlan: MaintenanceProposalPlan;
}

/** Per-status counts retained in brief-compatible metadata. */
export interface ProjectedMaintenanceToolOutcomeCounts {
  /** Number of write tools that mutated durable state. */
  applied: number;
  /** Number of write tools that failed. */
  failed: number;
  /** Number of user-visible proposal writes. */
  proposed: number;
  /** Number of write tools skipped or deduped without mutation. */
  skipped: number;
}

/** Brief-compatible metadata projected from maintenance write-tool outcomes. */
export interface ProjectedMaintenanceToolOutcomes {
  /** Per-status counts used by brief copy and filtering. */
  actionCounts: ProjectedMaintenanceToolOutcomeCounts;
  /** Bounded write-tool action fields safe to retain in brief metadata. */
  actions: MaintenanceToolOutcome[];
  /** Coarse brief kind selected from visible write-tool outcomes. */
  briefKind: MaintenanceBriefKind;
  /** Number of proposed write outcomes that should request a decision brief. */
  proposalCount: number;
  /** Durable receipt ids linked to the projected outcomes. */
  receiptIds: string[];
}

/**
 * Normalizes one write-tool outcome to bounded brief action metadata.
 *
 * Before:
 * - `{ toolName: "writeMemory", status: "applied", receiptId: undefined }`
 *
 * After:
 * - `{ toolName: "writeMemory", status: "applied" }`
 */
const projectAction = (outcome: MaintenanceToolOutcome): MaintenanceToolOutcome => ({
  ...(outcome.receiptId === undefined ? {} : { receiptId: outcome.receiptId }),
  ...(outcome.resourceId === undefined ? {} : { resourceId: outcome.resourceId }),
  status: outcome.status,
  ...(outcome.summary === undefined ? {} : { summary: outcome.summary }),
  toolName: outcome.toolName,
});

/**
 * Projects maintenance write-tool outcomes into brief-compatible metadata.
 *
 * Use when:
 * - Maintenance tools need a compact Daily Brief projection
 * - Tool outcomes should be classified as decision, insight, or silent metadata
 *
 * Expects:
 * - Outcomes are already bounded by write-tool result contracts
 * - Proposal create, refresh, and supersede tools use `proposed` status for visible decisions
 *
 * Returns:
 * - Counts, receipt ids, bounded actions, and the selected brief kind
 */
export const projectMaintenanceToolOutcomes = (
  input: ProjectMaintenanceToolOutcomesInput,
): ProjectedMaintenanceToolOutcomes => {
  const actionCounts: ProjectedMaintenanceToolOutcomeCounts = {
    applied: 0,
    failed: 0,
    proposed: 0,
    skipped: 0,
  };
  const receiptIds: string[] = [];

  for (const outcome of input.outcomes) {
    if (outcome.receiptId !== undefined) receiptIds.push(outcome.receiptId);

    if (outcome.status === 'applied') actionCounts.applied += 1;
    if (outcome.status === 'failed') actionCounts.failed += 1;
    if (outcome.status === 'proposed') actionCounts.proposed += 1;
    if (
      outcome.status === 'deduped' ||
      outcome.status === 'skipped_stale' ||
      outcome.status === 'skipped_unsupported'
    ) {
      actionCounts.skipped += 1;
    }
  }

  const proposalCount = input.outcomes.filter(
    (outcome) =>
      outcome.status === 'proposed' &&
      (outcome.toolName === 'createMaintenanceProposal' ||
        outcome.toolName === 'refreshMaintenanceProposal' ||
        outcome.toolName === 'supersedeMaintenanceProposal'),
  ).length;
  const hasVisibleRiskOutcome = input.outcomes.some(
    (outcome) => outcome.status === 'failed' || outcome.status === 'skipped_stale',
  );
  const briefKind: MaintenanceBriefKind =
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
  'closeMaintenanceProposal',
  'createMaintenanceProposal',
  'createSkillIfAbsent',
  'refreshMaintenanceProposal',
  'replaceSkillContentCAS',
  'supersedeMaintenanceProposal',
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

const getRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getBaseSnapshot = (value: unknown): MaintenanceProposalBaseSnapshot | undefined => {
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

const toActionStatus = (
  status: MaintenanceToolWriteResult['status'],
): MaintenanceActionStatusValue => {
  if (status === 'applied') return MaintenanceActionStatus.Applied;
  if (status === 'deduped') return MaintenanceActionStatus.Deduped;
  if (status === 'failed') return MaintenanceActionStatus.Failed;
  if (status === 'proposed') return MaintenanceActionStatus.Proposed;

  return MaintenanceActionStatus.Skipped;
};

const getRunStatus = (actions: MaintenanceReviewRunResult['actions']): ReviewRunStatus => {
  if (actions.length === 0) return ReviewRunStatus.Skipped;

  const failedCount = actions.filter(
    (action) => action.status === MaintenanceActionStatus.Failed,
  ).length;
  const successfulCount = actions.filter(
    (action) =>
      action.status === MaintenanceActionStatus.Applied ||
      action.status === MaintenanceActionStatus.Proposed,
  ).length;

  if (failedCount > 0 && successfulCount > 0) return ReviewRunStatus.PartiallyApplied;
  if (failedCount > 0) return ReviewRunStatus.Failed;
  if (successfulCount === 0) return ReviewRunStatus.Skipped;

  return ReviewRunStatus.Completed;
};

const getActionType = (toolName: string): MaintenanceActionPlan['actionType'] => {
  if (toolName === 'createSkillIfAbsent') return 'create_skill';
  if (toolName === 'replaceSkillContentCAS') return 'refine_skill';

  return 'proposal_only';
};

const getWriteToolCalls = (toolCalls: ChatToolPayload[]) =>
  toolCalls.filter((toolCall) => WRITE_TOOL_NAMES.has(toolCall.apiName));

const getToolCallForOutcome = (
  writeToolCalls: ChatToolPayload[],
  outcome: MaintenanceToolOutcome,
  cursors: Map<string, number>,
) => {
  const startIndex = cursors.get(outcome.toolName) ?? 0;
  const matchingIndex = writeToolCalls.findIndex(
    (toolCall, index) => index >= startIndex && toolCall.apiName === outcome.toolName,
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

const toEvidenceRefs = (value: unknown): MaintenanceActionPlan['evidenceRefs'] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = getRecord(item);
        const id = getString(record.id);
        const type = getString(record.type);

        return id && type
          ? [{ id, type: type as MaintenanceActionPlan['evidenceRefs'][number]['type'] }]
          : [];
      })
    : [];

const toTarget = (value: unknown): MaintenanceActionTarget | undefined => {
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
  if (value === MaintenanceRisk.High) return MaintenanceRisk.High;
  if (value === MaintenanceRisk.Medium) return MaintenanceRisk.Medium;

  return MaintenanceRisk.Low;
};

const toApplyMode = (value: unknown, outcome: MaintenanceToolOutcome) => {
  if (value === MaintenanceApplyMode.AutoApply) return MaintenanceApplyMode.AutoApply;
  if (value === MaintenanceApplyMode.Skip) return MaintenanceApplyMode.Skip;
  if (value === MaintenanceApplyMode.ProposalOnly) return MaintenanceApplyMode.ProposalOnly;

  return outcome.status === 'proposed'
    ? MaintenanceApplyMode.ProposalOnly
    : MaintenanceApplyMode.AutoApply;
};

const toConfidence = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;

const toSkillOperation = (value: unknown, userId: string): MaintenanceActionPlan['operation'] => {
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
};

const getRawActionType = (value: unknown): MaintenanceActionPlan['actionType'] | undefined => {
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

const getTargetDedupeKey = (
  actionType: MaintenanceActionPlan['actionType'],
  target: MaintenanceActionTarget | undefined,
) => {
  if (target?.skillDocumentId) return `skill:${target.skillDocumentId}`;
  if (target?.skillName) return `skill:${target.skillName}`;
  if (target?.memoryId) return `memory:${target.memoryId}`;

  return actionType;
};

const getCompleteBaseSnapshot = ({
  actionType,
  baseSnapshot,
  operation,
  target,
}: {
  actionType: MaintenanceActionPlan['actionType'];
  baseSnapshot: MaintenanceProposalBaseSnapshot | undefined;
  operation: MaintenanceActionPlan['operation'];
  target: MaintenanceActionTarget | undefined;
}): MaintenanceProposalBaseSnapshot | undefined => {
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
  outcome: MaintenanceToolOutcome;
  rawAction: unknown;
  userId: string;
}): MaintenanceProposalPlan['actions'][number] | undefined => {
  const record = getRecord(rawAction);
  const actionType = getRawActionType(record.actionType);
  const idempotencyKey =
    getString(record.idempotencyKey) ?? `${fallbackIdempotencyKey}:action:${index + 1}`;

  if (!actionType) return;

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
    dedupeKey: getString(record.dedupeKey) ?? getTargetDedupeKey(actionType, target),
    evidenceRefs: toEvidenceRefs(record.evidenceRefs),
    idempotencyKey,
    rationale: getString(record.rationale) ?? outcome.summary ?? 'Maintenance proposal action.',
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

const getProjectionActionsFromProposalArgs = ({
  args,
  idempotencyKey,
  outcome,
  sourceId,
  userId,
}: {
  args: Record<string, unknown>;
  idempotencyKey: string;
  outcome: MaintenanceToolOutcome;
  sourceId: string;
  userId: string;
}): MaintenanceProposalPlan['actions'] =>
  Array.isArray(args.actions)
    ? args.actions.flatMap((rawAction, index) => {
        const action = getProjectionActionFromRaw({
          fallbackIdempotencyKey: idempotencyKey,
          index,
          outcome,
          rawAction,
          userId,
        });

        return action ? [action] : [];
      })
    : [];

const getProjectionAction = ({
  args,
  idempotencyKey,
  outcome,
  toolName,
  userId,
}: {
  args: Record<string, unknown>;
  idempotencyKey: string;
  outcome: MaintenanceToolOutcome;
  toolName: string;
  userId: string;
}): MaintenanceProposalPlan['actions'][number] => {
  const actionType = getActionType(toolName);
  const skillDocumentId = getString(args.skillDocumentId) ?? outcome.resourceId;
  const skillName = getString(args.name);
  const baseSnapshot = getBaseSnapshot(args.baseSnapshot);
  const baseAction = {
    applyMode:
      outcome.status === 'proposed'
        ? MaintenanceApplyMode.ProposalOnly
        : MaintenanceApplyMode.AutoApply,
    confidence: 1,
    dedupeKey: getString(args.proposalKey) ?? outcome.resourceId ?? idempotencyKey,
    evidenceRefs: [],
    idempotencyKey,
    rationale: outcome.summary ?? 'Maintenance tool write outcome.',
    risk: outcome.status === 'failed' ? MaintenanceRisk.Medium : MaintenanceRisk.Low,
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
 * - Daily Brief projection still expects `MaintenanceReviewRunResult` and `MaintenanceProposalPlan`
 *
 * Expects:
 * - Runtime write outcomes and write tool calls are in execution order
 * - Tool write results have already passed safe mutation boundaries
 *
 * Returns:
 * - A completed/skipped/failed execution result plus a plan containing only confirmed tool writes
 */
export const projectMaintenanceToolRuntimeRun = (
  input: ProjectMaintenanceToolRuntimeRunInput,
): ProjectedMaintenanceToolRuntimeRun => {
  const writeToolCalls = getWriteToolCalls(input.toolCalls);
  const projectionActions: MaintenanceProposalPlan['actions'] = [];
  const executionActions: MaintenanceReviewRunResult['actions'] = [];
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
    const proposalActions =
      outcome.toolName === 'createMaintenanceProposal' ||
      outcome.toolName === 'refreshMaintenanceProposal' ||
      outcome.toolName === 'supersedeMaintenanceProposal'
        ? getProjectionActionsFromProposalArgs({
            args,
            idempotencyKey,
            outcome,
            sourceId: input.sourceId,
            userId: input.userId,
          })
        : [];

    if (
      outcome.toolName === 'createMaintenanceProposal' ||
      outcome.toolName === 'refreshMaintenanceProposal' ||
      outcome.toolName === 'supersedeMaintenanceProposal'
    ) {
      if (proposalActions.length > 0) {
        projectionActions.push(...proposalActions);
        executionActions.push(
          ...proposalActions.map((action) => ({
            idempotencyKey: action.idempotencyKey,
            ...(outcome.receiptId ? { receiptId: outcome.receiptId } : {}),
            ...(outcome.resourceId ? { resourceId: outcome.resourceId } : {}),
            status: toActionStatus(outcome.status),
            ...(outcome.summary ? { summary: outcome.summary } : {}),
          })),
        );
        continue;
      }

      executionActions.push({
        idempotencyKey,
        ...(outcome.receiptId ? { receiptId: outcome.receiptId } : {}),
        ...(outcome.resourceId ? { resourceId: outcome.resourceId } : {}),
        status: MaintenanceActionStatus.Skipped,
        summary:
          outcome.summary ??
          'Maintenance proposal lifecycle update did not include executable proposal actions.',
      });
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

  const projectionPlan: MaintenanceProposalPlan = {
    actions: projectionActions,
    ...(input.localDate ? { localDate: input.localDate } : {}),
    plannerVersion: 'maintenance-tool-first-runtime-v1',
    reviewScope: input.reviewScope,
    summary: input.content?.trim() || 'Maintenance tool-first runtime completed.',
  };
  const execution: MaintenanceReviewRunResult = {
    actions: executionActions,
    sourceId: input.sourceId,
    status: getRunStatus(executionActions),
  };

  return { execution, projectionPlan };
};
