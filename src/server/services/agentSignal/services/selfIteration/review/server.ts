import type { AgentSignalRuntimeService } from '@lobechat/builtin-tool-agent-signal';
import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import { pickTrimmedString, toRecord } from '@lobechat/utils';

import { AgentSignalNightlyReviewModel } from '@/database/models/agentSignal/nightlyReview';
import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { BriefModel } from '@/database/models/brief';
import { UserModel } from '@/database/models/user';
import type { BriefItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AGENT_SIGNAL_DEFAULTS } from '@/server/services/agentSignal/constants';
import { isAgentSignalEnabledForUser } from '@/server/services/agentSignal/featureGate';
import { runMemoryActionAgent } from '@/server/services/agentSignal/policies/analyzeIntent/actions/userMemory';
import { redisSourceEventStore } from '@/server/services/agentSignal/store/adapters/redis/sourceEventStore';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';
import { translation } from '@/server/translation';

import { persistAgentSignalReceipts } from '../../receiptService';
import { createAgentRunner, executeSelfIteration } from '../execute';
import { projectRun } from '../projection';
import type { CreateServerSelfIterationPolicyOptions } from '../server';
import { listServerSelfReviewProposalActivity } from '../server';
import type {
  CloseSelfReviewProposalInput,
  CreateSelfReviewProposalInput,
  CreateSkillIfAbsentInput,
  OperationReservation,
  RefreshSelfReviewProposalInput,
  ReplaceSkillContentCASInput,
  SupersedeSelfReviewProposalInput,
  ToolReceiptInput,
  ToolWriteResult,
  WriteMemoryInput,
} from '../tools/shared';
import { createMemoryService, createToolSet } from '../tools/shared';
import type { EvidenceRef } from '../types';
import { Risk, Scope } from '../types';
import { createBriefSelfReviewService, createServerSelfReviewBriefWriter } from './brief';
import type { SelfReviewBriefTextTranslator } from './briefText';
import type {
  FeedbackActivityDigest,
  NightlyReviewManagedSkillSummary,
  NightlyReviewRelevantMemorySummary,
  NightlyReviewTopicActivityRow,
  ReceiptActivityDigest,
  ToolActivityDigest,
} from './collect';
import { createSelfReviewContextService, mapNightlyDocumentActivityRows } from './collect';
import type { CreateNightlyReviewSourceHandlerDependencies } from './handler';
import type { SelfReviewProposalAction, SelfReviewProposalMetadata } from './proposal';
import {
  getSelfReviewProposalFromBriefMetadata,
  refreshSelfReviewProposal,
  supersedeSelfReviewProposal,
} from './proposal';
import { createSelfReviewProposalPreflightService } from './proposalPreflight';
import { createSelfReviewProposalSnapshotService } from './proposalSnapshot';

const NIGHTLY_REVIEW_SOURCE_TYPE = 'agent.nightly_review.requested';
const SELF_ITERATION_OPERATION_STATE_TTL_SECONDS = AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds;

interface ProposalBriefReader {
  listUnresolvedByAgentAndTrigger: (options: {
    agentId: string;
    limit?: number;
    trigger: string;
  }) => Promise<Awaited<ReturnType<BriefModel['listUnresolvedByAgentAndTrigger']>>>;
}

const selfIterationOperationScopeKey = (idempotencyKey: string) =>
  `shared-operation:${idempotencyKey}`;

const selfIterationOperationReserveKey = (idempotencyKey: string) =>
  `shared-operation-reserve:${idempotencyKey}`;

const parseStoredOperationResult = (
  payload: Record<string, string> | undefined,
): ToolWriteResult | undefined => {
  if (!payload?.result) return;

  try {
    const result = JSON.parse(payload.result) as ToolWriteResult;

    if (
      result.status === 'applied' ||
      result.status === 'deduped' ||
      result.status === 'failed' ||
      result.status === 'proposed' ||
      result.status === 'skipped_stale' ||
      result.status === 'skipped_unsupported'
    ) {
      return result;
    }
  } catch {
    return;
  }
};

const createSkippedOperationResult = (): ToolWriteResult => ({
  status: 'skipped_unsupported',
  summary:
    'Self-iteration operation is already reserved or Redis is unavailable; skipped to avoid duplicate mutation.',
});

const reserveSelfIterationOperation = async (
  idempotencyKey: string,
): Promise<OperationReservation> => {
  const scopeKey = selfIterationOperationScopeKey(idempotencyKey);
  const existing = parseStoredOperationResult(await redisSourceEventStore.readWindow(scopeKey));

  if (existing) return { existing, reserved: false };

  // NOTICE:
  // Redis is the only available cross-worker idempotency boundary for nightly tool writes.
  // `tryDedupe` also returns false when the Redis client is unavailable, so the safe fallback is
  // to skip mutation instead of writing without a durable reservation.
  // Source/context: `src/server/services/agentSignal/store/adapters/redis/sourceEventStore.ts`.
  // Removal condition: replace with a database-backed self-iteration operation ledger.
  const reserved = await redisSourceEventStore.tryDedupe(
    selfIterationOperationReserveKey(idempotencyKey),
    SELF_ITERATION_OPERATION_STATE_TTL_SECONDS,
  );

  if (reserved) return { reserved: true };

  return {
    existing:
      parseStoredOperationResult(await redisSourceEventStore.readWindow(scopeKey)) ??
      createSkippedOperationResult(),
    reserved: false,
  };
};

const completeSelfIterationOperation = async (input: ToolReceiptInput) => {
  await redisSourceEventStore.writeWindow(
    selfIterationOperationScopeKey(input.idempotencyKey),
    {
      result: JSON.stringify({
        ...(input.receiptId ? { receiptId: input.receiptId } : {}),
        ...(input.resourceId ? { resourceId: input.resourceId } : {}),
        status: input.status,
        ...(input.summary ? { summary: input.summary } : {}),
      } satisfies ToolWriteResult),
    },
    SELF_ITERATION_OPERATION_STATE_TTL_SECONDS,
  );
};

const getToolReceiptStatus = (
  status: ToolReceiptInput['status'],
): 'applied' | 'failed' | 'proposed' | 'skipped' => {
  if (status === 'applied') return 'applied';
  if (status === 'failed') return 'failed';
  if (status === 'proposed') return 'proposed';

  return 'skipped';
};

const writeSelfReviewToolReceipt = async ({
  agentId,
  input,
  sourceId,
  userId,
}: {
  agentId: string;
  input: ToolReceiptInput;
  sourceId: string;
  userId: string;
}) => {
  await persistAgentSignalReceipts([
    {
      agentId,
      createdAt: Date.now(),
      detail: input.summary ?? `Self-review tool ${input.toolName} finished with ${input.status}.`,
      id: input.idempotencyKey,
      kind:
        input.toolName === 'createSkillIfAbsent' || input.toolName === 'replaceSkillContentCAS'
          ? 'skill'
          : 'review',
      metadata: {
        sourceType: NIGHTLY_REVIEW_SOURCE_TYPE,
      },
      sourceId,
      sourceType: NIGHTLY_REVIEW_SOURCE_TYPE,
      status: getToolReceiptStatus(input.status),
      ...(input.resourceId &&
      (input.toolName === 'createSkillIfAbsent' || input.toolName === 'replaceSkillContentCAS')
        ? {
            target: {
              id: input.resourceId,
              ...(input.summary ? { summary: input.summary } : {}),
              title: input.summary ?? input.resourceId,
              type: 'skill',
            },
          }
        : {}),
      title: input.summary ?? 'Self-review tool outcome',
      topicId: sourceId,
      userId,
    },
  ]);

  return { receiptId: input.idempotencyKey };
};

const createSkillProposalAction = (input: CreateSkillIfAbsentInput): SelfReviewProposalAction => ({
  actionType: 'create_skill',
  baseSnapshot: {
    absent: true,
    skillName: input.name,
    targetType: 'skill',
  },
  evidenceRefs: [],
  idempotencyKey: input.idempotencyKey,
  operation: {
    domain: 'skill',
    input: {
      bodyMarkdown: input.bodyMarkdown,
      description: input.description,
      name: input.name,
      title: input.title,
      userId: input.userId,
    },
    operation: 'create',
  },
  rationale: input.summary ?? `Create managed skill ${input.name}.`,
  risk: Risk.Low,
  target: { skillName: input.name },
});

const createRefineProposalAction = (
  input: ReplaceSkillContentCASInput,
): SelfReviewProposalAction => ({
  actionType: 'refine_skill',
  baseSnapshot: input.baseSnapshot,
  evidenceRefs: [],
  idempotencyKey: input.idempotencyKey,
  operation: {
    domain: 'skill',
    input: {
      bodyMarkdown: input.bodyMarkdown,
      patch: input.summary,
      skillDocumentId: input.skillDocumentId,
      userId: input.userId,
    },
    operation: 'refine',
  },
  rationale: input.summary ?? `Refine managed skill ${input.skillDocumentId}.`,
  risk: Risk.Low,
  target: { skillDocumentId: input.skillDocumentId },
});

const toRecordOrEmpty = (value: unknown): Record<string, unknown> =>
  (toRecord(value) as Record<string, unknown> | undefined) ?? {};

const getStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const text = pickTrimmedString(item);
        return text ? [text] : [];
      })
    : [];

const getBriefMetadataWithProposal = (
  brief: BriefItem,
  proposal: SelfReviewProposalMetadata,
): BriefItem['metadata'] => {
  const metadata = toRecordOrEmpty(brief.metadata);
  const agentSignal = toRecordOrEmpty(metadata.agentSignal);
  const nightlySelfReview = toRecordOrEmpty(agentSignal.nightlySelfReview);

  return {
    ...metadata,
    agentSignal: {
      ...agentSignal,
      nightlySelfReview: {
        ...nightlySelfReview,
        selfReviewProposal: proposal,
      },
    },
  };
};

const getProposalToolCallPayload = (
  toolName: string,
  input:
    | CreateSelfReviewProposalInput
    | RefreshSelfReviewProposalInput
    | SupersedeSelfReviewProposalInput,
) => ({
  apiName: toolName,
  arguments: JSON.stringify(input),
  id: `${input.idempotencyKey}:tool-call`,
  identifier: 'agent-signal-self-iteration',
  type: 'builtin' as const,
});

const collectPlanEvidenceRefs = (plan: ReturnType<typeof projectRun>['projectionPlan']) => {
  const evidenceRefs = new Map<string, EvidenceRef>();

  for (const action of plan.actions) {
    for (const evidenceRef of action.evidenceRefs) {
      evidenceRefs.set(`${evidenceRef.type}:${evidenceRef.id}`, evidenceRef);
    }
  }

  return [...evidenceRefs.values()];
};

const getProposalActionSnapshotInput = (action: Record<string, unknown>) => {
  const operation = toRecordOrEmpty(action.operation);
  const operationInput = toRecordOrEmpty(operation.input);
  const target = toRecordOrEmpty(action.target);

  return {
    ...operationInput,
    name: pickTrimmedString(operationInput.name) ?? pickTrimmedString(target.skillName),
    skillDocumentId:
      pickTrimmedString(operationInput.skillDocumentId) ??
      pickTrimmedString(target.skillDocumentId),
    title: pickTrimmedString(operationInput.title) ?? pickTrimmedString(target.skillName),
  };
};

const withCompleteProposalSnapshots = async ({
  agentId,
  input,
  snapshotService,
  userId,
}: {
  agentId: string;
  input: CreateSelfReviewProposalInput;
  snapshotService: ReturnType<typeof createSelfReviewProposalSnapshotService>;
  userId: string;
}): Promise<CreateSelfReviewProposalInput> => {
  if (!input.actions || input.actions.length === 0) {
    throw new Error('Self-review proposal requires at least one action.');
  }

  const actions = await Promise.all(
    input.actions.map(async (rawAction) => {
      const action = toRecordOrEmpty(rawAction);
      const actionType = action.actionType;

      if (actionType === 'consolidate_skill') {
        const operation = toRecordOrEmpty(action.operation);
        const operationInput = toRecordOrEmpty(operation.input);
        const canonicalSkillDocumentId = pickTrimmedString(operationInput.canonicalSkillDocumentId);
        const sourceSkillIds = getStringArray(operationInput.sourceSkillIds);
        const sourceSnapshots = await Promise.all(
          sourceSkillIds.map((skillDocumentId) =>
            snapshotService.captureActionSnapshot({
              actionType: 'refine_skill',
              agentId,
              input: { skillDocumentId },
              userId,
            }),
          ),
        );

        return {
          ...action,
          ...(canonicalSkillDocumentId
            ? {
                baseSnapshot: await snapshotService.captureActionSnapshot({
                  actionType: 'refine_skill',
                  agentId,
                  input: { skillDocumentId: canonicalSkillDocumentId },
                  userId,
                }),
              }
            : {}),
          operation: {
            ...operation,
            input: {
              ...operationInput,
              sourceSnapshots,
            },
          },
        };
      }

      if (actionType !== 'create_skill' && actionType !== 'refine_skill') return rawAction;

      return {
        ...action,
        baseSnapshot: await snapshotService.captureActionSnapshot({
          actionType,
          agentId,
          input: getProposalActionSnapshotInput(action),
          userId,
        }),
      };
    }),
  );

  return { ...input, actions };
};

const isCompleteRefineToolSnapshot = (
  snapshot: ReplaceSkillContentCASInput['baseSnapshot'],
): snapshot is NonNullable<ReplaceSkillContentCASInput['baseSnapshot']> & {
  agentDocumentId: string;
  contentHash: string;
  documentId: string;
} =>
  snapshot?.targetType === 'skill' &&
  typeof snapshot.agentDocumentId === 'string' &&
  snapshot.agentDocumentId.trim().length > 0 &&
  typeof snapshot.contentHash === 'string' &&
  snapshot.contentHash.trim().length > 0 &&
  typeof snapshot.documentId === 'string' &&
  snapshot.documentId.trim().length > 0 &&
  snapshot.managed === true &&
  snapshot.writable === true;

const withCompleteReplaceSkillSnapshot = async ({
  agentId,
  input,
  snapshotService,
  userId,
}: {
  agentId: string;
  input: ReplaceSkillContentCASInput;
  snapshotService: ReturnType<typeof createSelfReviewProposalSnapshotService>;
  userId: string;
}): Promise<ReplaceSkillContentCASInput> => {
  if (isCompleteRefineToolSnapshot(input.baseSnapshot)) return input;

  const baseSnapshot = await snapshotService.captureActionSnapshot({
    actionType: 'refine_skill',
    agentId,
    input: {
      skillDocumentId: input.skillDocumentId,
    },
    userId,
  });

  return {
    ...input,
    baseSnapshot,
    // NOTICE:
    // `replaceSkillContentCAS` can be called with either the managed skill bundle id or its
    // SKILL.md index agent document id. Snapshot capture resolves both to the bundle id, and
    // approve-time preflight compares the action target against that resolved bundle id.
    // Without normalizing here, a valid index-targeted write is reported as target drift
    // (`target_type_changed`) even though it points to the same managed skill.
    // Removal condition: remove only if preflight natively accepts equivalent bundle/index ids.
    skillDocumentId: baseSnapshot.agentDocumentId ?? input.skillDocumentId,
  };
};

const createProposalProjectionFromToolInput = ({
  input,
  localDate,
  sourceId,
  toolName,
  userId,
}: {
  input: CreateSelfReviewProposalInput;
  localDate: string;
  sourceId: string;
  toolName: 'createSelfReviewProposal';
  userId: string;
}) =>
  projectRun({
    content: input.summary,
    includeProposalLifecycleActions: true,
    localDate,
    outcomes: [
      {
        receiptId: input.idempotencyKey,
        status: 'proposed',
        summary: input.summary,
        toolName,
      },
    ],
    reviewScope: Scope.Nightly,
    sourceId,
    toolCalls: [getProposalToolCallPayload(toolName, input)],
    userId,
  });

const findSelfReviewProposalBrief = async ({
  agentId,
  briefModel,
  proposalId,
  proposalKey,
}: {
  agentId: string;
  briefModel: ProposalBriefReader;
  proposalId?: string;
  proposalKey?: string;
}) => {
  const rows = await briefModel.listUnresolvedByAgentAndTrigger({
    agentId,
    limit: 20,
    trigger: 'agent-signal:nightly-review',
  });

  return rows.find((row) => {
    if (proposalId && row.id === proposalId) return true;

    const proposal = getSelfReviewProposalFromBriefMetadata(row.metadata);

    return proposalKey ? proposal?.proposalKey === proposalKey : false;
  });
};

const updateSelfReviewProposalBrief = async ({
  agentId,
  briefModel,
  proposalId,
  proposalKey,
  updateProposal,
}: {
  agentId: string;
  briefModel: BriefModel;
  proposalId?: string;
  proposalKey?: string;
  updateProposal: (proposal: SelfReviewProposalMetadata) => SelfReviewProposalMetadata;
}) => {
  const brief = await findSelfReviewProposalBrief({
    agentId,
    briefModel,
    proposalId,
    proposalKey,
  });

  if (!brief) throw new Error('Self-review proposal not found');

  const existingProposal = getSelfReviewProposalFromBriefMetadata(brief.metadata);
  if (!existingProposal) throw new Error('Self-review proposal metadata not found');

  const updatedProposal = updateProposal(existingProposal);
  const updatedBrief = await briefModel.updateMetadata(
    brief.id,
    getBriefMetadataWithProposal(brief, updatedProposal),
  );

  return {
    resourceId: updatedBrief?.id ?? brief.id,
    summary: `Updated self-review proposal ${updatedProposal.proposalKey}.`,
  };
};

export interface ReviewRuntimePrimitiveDeps {
  agentId: string;
  briefModel: BriefModel;
  briefTextTranslator?: SelfReviewBriefTextTranslator;
  db: LobeChatDatabase;
  localDate: string;
  proposalBriefWriter: ReturnType<typeof createServerSelfReviewBriefWriter>;
  reviewWindowEnd: string;
  reviewWindowStart: string;
  skillDocumentService: SkillManagementDocumentService;
  sourceId: string;
  userId: string;
}

/**
 * Builds the nightly-review tool primitives for the execAgent path — pure live
 * DB reads + durable writes, keyed to match the advertised api names.
 *
 * Unlike {@link createServerToolSet}, these carry no `reserveOperation` /
 * receipt / `completeOperation` side channel: idempotency and receipt
 * projection live on the execAgent completion path, so a tool call only reads
 * or mutates. The evidence corpus is embedded in the agent's prompt, so there
 * is deliberately no `getEvidenceDigest` primitive — the agent reads evidence
 * from its own context, and these tools only touch live state.
 */
export const createReviewRuntimePrimitives = (
  deps: ReviewRuntimePrimitiveDeps,
): AgentSignalRuntimeService => {
  const {
    agentId,
    briefModel,
    briefTextTranslator,
    db,
    localDate,
    proposalBriefWriter,
    reviewWindowEnd,
    reviewWindowStart,
    skillDocumentService,
    sourceId,
    userId,
  } = deps;

  const isSkillNameAvailable = async ({
    agentId: targetAgentId,
    name,
  }: {
    agentId?: string;
    name: string;
  }) => {
    const skills = await skillDocumentService.listSkills({ agentId: targetAgentId ?? agentId });

    return !skills.some((skill) => skill.name === name);
  };
  const readSkillTargetSnapshot = (skillDocumentId: string) =>
    skillDocumentService.readSkillTargetSnapshot({ agentDocumentId: skillDocumentId, agentId });

  const proposalPreflight = createSelfReviewProposalPreflightService({
    isSkillNameAvailable,
    readSkillTargetSnapshot,
  });
  const proposalSnapshot = createSelfReviewProposalSnapshotService({
    isSkillNameAvailable,
    readSkillTargetSnapshot,
  });

  return {
    closeSelfReviewProposal: async (rawInput) => {
      const input = rawInput as unknown as CloseSelfReviewProposalInput;

      return updateSelfReviewProposalBrief({
        agentId,
        briefModel,
        proposalId: input.proposalId,
        proposalKey: input.proposalKey,
        updateProposal: (proposal) => ({
          ...proposal,
          status: 'dismissed',
          updatedAt: new Date().toISOString(),
        }),
      });
    },
    createSelfReviewProposal: async (rawInput) => {
      const input = rawInput as unknown as CreateSelfReviewProposalInput;
      const projectionInput = await withCompleteProposalSnapshots({
        agentId,
        input,
        snapshotService: proposalSnapshot,
        userId,
      });
      const projection = createProposalProjectionFromToolInput({
        input: projectionInput,
        localDate,
        sourceId,
        toolName: 'createSelfReviewProposal',
        userId,
      });
      const brief = createBriefSelfReviewService().projectNightlyReviewBrief({
        agentId,
        evidenceRefs: collectPlanEvidenceRefs(projection.projectionPlan),
        ideas: projection.ideas,
        localDate,
        plan: projection.projectionPlan,
        result: projection.execution,
        reviewWindowEnd,
        reviewWindowStart,
        t: briefTextTranslator,
        timezone: 'UTC',
        userId,
      });

      if (!brief) throw new Error('Self-review proposal projection produced no brief');

      const result = await proposalBriefWriter.writeDailyBrief(brief);

      return {
        proposalId: result?.id,
        resourceId: result?.id,
        summary: input.summary ?? 'Created self-review proposal.',
      };
    },
    createSkillIfAbsent: async (rawInput) => {
      const input = rawInput as unknown as CreateSkillIfAbsentInput;

      if (!pickTrimmedString(input.name) || !pickTrimmedString(input.bodyMarkdown)) {
        return {
          status: 'skipped_unsupported',
          summary: 'Skill creation requires a non-empty name and body.',
        };
      }

      const preflight = await proposalPreflight.checkAction(createSkillProposalAction(input));
      if (!preflight.allowed) {
        return {
          status: 'skipped_stale',
          summary: `Skill creation preflight failed: ${preflight.reason}`,
        };
      }

      const result = await skillDocumentService.createSkill({
        agentId,
        bodyMarkdown: input.bodyMarkdown,
        description: input.description ?? 'Agent Signal managed skill.',
        name: input.name,
        title: input.title ?? input.name,
      });

      return {
        resourceId: result.bundle.agentDocumentId,
        summary: `Created managed skill ${result.name}.`,
      };
    },
    getManagedSkill: async (rawInput) => {
      const { agentId: targetAgentId, skillDocumentId } = rawInput as {
        agentId?: string;
        skillDocumentId: string;
      };

      return skillDocumentService.getSkill({
        agentDocumentId: skillDocumentId,
        agentId: targetAgentId ?? agentId,
        includeContent: true,
      });
    },
    listManagedSkills: async (rawInput) => {
      const { agentId: targetAgentId } = rawInput as { agentId?: string };

      return skillDocumentService.listSkills({ agentId: targetAgentId ?? agentId });
    },
    listSelfReviewProposals: async (rawInput) => {
      const { agentId: targetAgentId } = rawInput as { agentId?: string };
      const digest = await listServerSelfReviewProposalActivity({
        agentId: targetAgentId ?? agentId,
        briefModel,
        userId,
      });

      return [digest];
    },
    readSelfReviewProposal: async (rawInput) => {
      const { proposalId, proposalKey } = rawInput as {
        proposalId?: string;
        proposalKey?: string;
      };
      const digest = await listServerSelfReviewProposalActivity({ agentId, briefModel, userId });

      return digest.active.find(
        (proposal) =>
          (proposalId && proposal.proposalId === proposalId) ||
          (proposalKey && proposal.proposalKey === proposalKey),
      );
    },
    refreshSelfReviewProposal: async (rawInput) => {
      const input = rawInput as unknown as RefreshSelfReviewProposalInput;

      return updateSelfReviewProposalBrief({
        agentId,
        briefModel,
        proposalId: input.proposalId,
        proposalKey: input.proposalKey,
        updateProposal: (proposal) =>
          refreshSelfReviewProposal({
            existing: proposal,
            incoming: proposal,
            now: new Date().toISOString(),
          }),
      });
    },
    replaceSkillContentCAS: async (rawInput) => {
      const input = rawInput as unknown as ReplaceSkillContentCASInput;
      const enriched = await withCompleteReplaceSkillSnapshot({
        agentId,
        input,
        snapshotService: proposalSnapshot,
        userId,
      });

      if (!pickTrimmedString(enriched.bodyMarkdown)) {
        return {
          resourceId: enriched.skillDocumentId,
          status: 'skipped_unsupported',
          summary: 'Skill replacement requires a non-empty body.',
        };
      }

      if (!isCompleteRefineToolSnapshot(enriched.baseSnapshot)) {
        return {
          resourceId: enriched.skillDocumentId,
          status: 'skipped_unsupported',
          summary: 'Skill replacement requires a complete base snapshot.',
        };
      }

      const preflight = await proposalPreflight.checkAction(createRefineProposalAction(enriched));
      if (!preflight.allowed) {
        return {
          resourceId: enriched.skillDocumentId,
          status: 'skipped_stale',
          summary: preflight.reason || input.summary,
        };
      }

      const result = await skillDocumentService.replaceSkillIndex({
        agentDocumentId: enriched.skillDocumentId,
        agentId,
        bodyMarkdown: enriched.bodyMarkdown,
        description: enriched.description,
      });

      if (!result) throw new Error('Skill target not found');

      return {
        resourceId: result.bundle.agentDocumentId,
        summary: `Refined managed skill ${result.name}.`,
      };
    },
    supersedeSelfReviewProposal: async (rawInput) => {
      const input = rawInput as unknown as SupersedeSelfReviewProposalInput;

      return updateSelfReviewProposalBrief({
        agentId,
        briefModel,
        proposalId: input.proposalId,
        proposalKey: input.proposalKey,
        updateProposal: (proposal) =>
          supersedeSelfReviewProposal({
            existing: proposal,
            now: new Date().toISOString(),
            supersededBy: input.supersededBy,
          }),
      });
    },
    writeMemory: async (rawInput) => {
      const input = rawInput as unknown as WriteMemoryInput;
      const memoryService = createMemoryService({
        writeMemory: async ({ content, evidenceRefs, idempotencyKey }) => {
          const result = await runMemoryActionAgent(
            {
              agentId,
              message: content,
              reason: `Agent Signal self-review memory candidate from ${evidenceRefs.length} evidence refs.`,
            },
            { db, userId },
          );

          if (result.status !== 'applied') {
            throw new Error(
              result.detail ?? 'Memory action agent did not apply a durable memory write.',
            );
          }

          return {
            memoryId: idempotencyKey,
            summary: result.detail ?? content,
          };
        },
      });
      const result = await memoryService.writeMemory({
        evidenceRefs: input.evidenceRefs,
        idempotencyKey: input.idempotencyKey,
        input: {
          content: input.content,
          userId: input.userId,
        },
      });

      return {
        resourceId: result.memoryId,
        summary: result.summary,
      };
    },
  };
};

export const createServerToolSet = ({
  agentId,
  briefModel,
  briefTextTranslator,
  context,
  db,
  localDate,
  proposalBriefWriter,
  skillDocumentService,
  sourceId,
  userId,
}: {
  agentId: string;
  briefModel: BriefModel;
  briefTextTranslator?: SelfReviewBriefTextTranslator;
  context: Parameters<
    CreateNightlyReviewSourceHandlerDependencies['runSelfReviewAgent']
  >[0]['context'];
  db: LobeChatDatabase;
  localDate: string;
  proposalBriefWriter: ReturnType<typeof createServerSelfReviewBriefWriter>;
  skillDocumentService: SkillManagementDocumentService;
  sourceId: string;
  userId: string;
}) => {
  const proposalPreflight = createSelfReviewProposalPreflightService({
    isSkillNameAvailable: async ({ agentId: targetAgentId, name }) => {
      const skills = await skillDocumentService.listSkills({ agentId: targetAgentId ?? agentId });

      return !skills.some((skill) => skill.name === name);
    },
    readSkillTargetSnapshot: (skillDocumentId) =>
      skillDocumentService.readSkillTargetSnapshot({
        agentDocumentId: skillDocumentId,
        agentId,
      }),
  });
  const proposalSnapshot = createSelfReviewProposalSnapshotService({
    isSkillNameAvailable: async ({ agentId: targetAgentId, name }) => {
      const skills = await skillDocumentService.listSkills({ agentId: targetAgentId ?? agentId });

      return !skills.some((skill) => skill.name === name);
    },
    readSkillTargetSnapshot: (skillDocumentId) =>
      skillDocumentService.readSkillTargetSnapshot({
        agentDocumentId: skillDocumentId,
        agentId,
      }),
  });

  return createToolSet({
    closeProposal: async (input: CloseSelfReviewProposalInput) =>
      updateSelfReviewProposalBrief({
        agentId,
        briefModel,
        proposalId: input.proposalId,
        proposalKey: input.proposalKey,
        updateProposal: (proposal) => ({
          ...proposal,
          status: 'dismissed',
          updatedAt: new Date().toISOString(),
        }),
      }),
    completeOperation: completeSelfIterationOperation,
    completeReplaceSkillInput: (input) =>
      withCompleteReplaceSkillSnapshot({
        agentId,
        input,
        snapshotService: proposalSnapshot,
        userId,
      }),
    createProposal: async (input) => {
      const projectionInput = await withCompleteProposalSnapshots({
        agentId,
        input,
        snapshotService: proposalSnapshot,
        userId,
      });
      const projection = createProposalProjectionFromToolInput({
        input: projectionInput,
        localDate,
        sourceId,
        toolName: 'createSelfReviewProposal',
        userId,
      });
      const brief = createBriefSelfReviewService().projectNightlyReviewBrief({
        agentId,
        evidenceRefs: collectPlanEvidenceRefs(projection.projectionPlan),
        ideas: projection.ideas,
        localDate,
        plan: projection.projectionPlan,
        result: projection.execution,
        reviewWindowEnd: context.reviewWindowEnd,
        reviewWindowStart: context.reviewWindowStart,
        t: briefTextTranslator,
        timezone: 'UTC',
        userId,
      });

      if (!brief) throw new Error('Self-review proposal projection produced no brief');

      const result = await proposalBriefWriter.writeDailyBrief(brief);

      return {
        proposalId: result?.id,
        resourceId: result?.id,
        summary: input.summary ?? 'Created self-review proposal.',
      };
    },
    createSkill: async (input) => {
      const preflight = await proposalPreflight.checkAction(createSkillProposalAction(input));
      if (!preflight.allowed) {
        throw new Error(`Skill creation preflight failed: ${preflight.reason}`);
      }

      const result = await skillDocumentService.createSkill({
        agentId,
        bodyMarkdown: input.bodyMarkdown,
        description: input.description ?? 'Agent Signal managed skill.',
        name: input.name,
        title: input.title ?? input.name,
      });

      return {
        resourceId: result.bundle.agentDocumentId,
        summary: `Created managed skill ${result.name}.`,
      };
    },
    writeMemory: async (input: WriteMemoryInput) => {
      // TODO: Harden the real writeMemory E2E path. Local QStash verification showed this
      // tool reaches the memory action agent, but the agent does not always converge to an
      // applied receipt/brief. Keep this marker until the memory auto-apply case has a
      // deterministic eval plus a passing end-to-end run.
      const memoryService = createMemoryService({
        writeMemory: async ({ content, evidenceRefs, idempotencyKey }) => {
          const result = await runMemoryActionAgent(
            {
              agentId,
              message: content,
              reason: `Agent Signal self-review memory candidate from ${evidenceRefs.length} evidence refs.`,
            },
            {
              db,
              userId,
            },
          );

          if (result.status !== 'applied') {
            throw new Error(
              result.detail ?? 'Memory action agent did not apply a durable memory write.',
            );
          }

          return {
            memoryId: idempotencyKey,
            summary: result.detail ?? content,
          };
        },
      });
      const result = await memoryService.writeMemory({
        evidenceRefs: input.evidenceRefs,
        idempotencyKey: input.idempotencyKey,
        input: {
          content: input.content,
          userId: input.userId,
        },
      });

      return {
        resourceId: result.memoryId,
        summary: result.summary,
      };
    },
    getEvidenceDigest: async ({ evidenceIds }) => {
      const selectedEvidenceIds = new Set(evidenceIds ?? []);
      const includeAll = selectedEvidenceIds.size === 0;
      const hasSelectedEvidence = (refs: { id: string }[] | undefined) =>
        refs?.some((ref) => selectedEvidenceIds.has(ref.id)) ?? false;

      return {
        documentActivity: context.documentActivity,
        selfReviewSignals: includeAll
          ? context.selfReviewSignals
          : context.selfReviewSignals.filter((signal) => hasSelectedEvidence(signal.evidenceRefs)),
        managedSkills: context.managedSkills,
        proposalActivity: context.proposalActivity,
        receiptActivity: context.receiptActivity,
        toolActivity: context.toolActivity,
        topics: includeAll
          ? context.topics
          : context.topics.filter(
              (topic) =>
                hasSelectedEvidence(topic.evidenceRefs) ||
                topic.failedMessages?.some((message) =>
                  selectedEvidenceIds.has(message.messageId),
                ) ||
                topic.failedToolCalls?.some(
                  (toolCall) =>
                    selectedEvidenceIds.has(toolCall.messageId) ||
                    (toolCall.toolCallId && selectedEvidenceIds.has(toolCall.toolCallId)),
                ),
            ),
      };
    },
    getManagedSkill: ({ agentId: targetAgentId, skillDocumentId }) =>
      skillDocumentService.getSkill({
        agentDocumentId: skillDocumentId,
        agentId: targetAgentId,
        includeContent: true,
      }),
    listSelfReviewProposals: ({ agentId: targetAgentId }) =>
      listServerSelfReviewProposalActivity({
        agentId: targetAgentId,
        briefModel,
        userId,
      }).then((digest) => [digest]),
    listManagedSkills: ({ agentId: targetAgentId }) =>
      skillDocumentService.listSkills({ agentId: targetAgentId }),
    preflight: async (input) => {
      if ('skillDocumentId' in input) {
        const result = await proposalPreflight.checkAction(createRefineProposalAction(input));

        return result.allowed ? { allowed: true } : { allowed: false, reason: result.reason };
      }

      return { allowed: true };
    },
    readProposal: async ({ proposalId, proposalKey }) => {
      const digest = await listServerSelfReviewProposalActivity({
        agentId,
        briefModel,
        userId,
      });

      return digest.active.find(
        (proposal) =>
          (proposalId && proposal.proposalId === proposalId) ||
          (proposalKey && proposal.proposalKey === proposalKey),
      );
    },
    refreshProposal: async (input: RefreshSelfReviewProposalInput) =>
      updateSelfReviewProposalBrief({
        agentId,
        briefModel,
        proposalId: input.proposalId,
        proposalKey: input.proposalKey,
        updateProposal: (proposal) =>
          refreshSelfReviewProposal({
            existing: proposal,
            incoming: proposal,
            now: new Date().toISOString(),
          }),
      }),
    replaceSkill: async (input) => {
      const result = await skillDocumentService.replaceSkillIndex({
        agentDocumentId: input.skillDocumentId,
        agentId,
        bodyMarkdown: input.bodyMarkdown,
        description: input.description,
      });

      if (!result) throw new Error('Skill target not found');

      return {
        resourceId: result.bundle.agentDocumentId,
        summary: `Refined managed skill ${result.name}.`,
      };
    },
    reserveOperation: reserveSelfIterationOperation,
    supersedeProposal: async (input: SupersedeSelfReviewProposalInput) =>
      updateSelfReviewProposalBrief({
        agentId,
        briefModel,
        proposalId: input.proposalId,
        proposalKey: input.proposalKey,
        updateProposal: (proposal) =>
          supersedeSelfReviewProposal({
            existing: proposal,
            now: new Date().toISOString(),
            supersededBy: input.supersededBy,
          }),
      }),
    writeReceipt: (input) => writeSelfReviewToolReceipt({ agentId, input, sourceId, userId }),
  });
};

/**
 * Creates server runtime handlers for periodic self-review sources.
 *
 * Call stack:
 *
 * runAgentSignalWorkflow
 *   -> {@link createServerSelfReviewPolicyOptions}
 *     -> review source handler dependencies
 *       -> tool-first self-review executor
 *
 * Use when:
 * - The Agent Signal workflow consumes `agent.nightly_review.requested`
 * - Runtime policy composition needs collection, review, receipts, and Daily Brief writing
 *
 * Expects:
 * - The scheduler has already emitted a stable nightly source id
 * - The handler will re-check feature gates and idempotency before reviewer work
 *
 * Returns:
 * - Nightly review handler options ready for `createDefaultAgentSignalPolicies`
 */
export const createServerSelfReviewPolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
}: CreateServerSelfIterationPolicyOptions): CreateNightlyReviewSourceHandlerDependencies => {
  const nightlyReviewModel = new AgentSignalNightlyReviewModel(db);
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId);
  const briefModel = new BriefModel(db, userId);
  const skillDocumentService = new SkillManagementDocumentService(db, userId);
  const collector = createSelfReviewContextService({
    listDocumentActivity: async ({ agentId: targetAgentId, reviewWindowEnd, reviewWindowStart }) =>
      tracer.startActiveSpan(
        'agent_signal.nightly_review.collector.list_document_activity',
        {
          attributes: {
            'agent.signal.agent_id': targetAgentId,
            'agent.signal.user_id': userId,
          },
        },
        async (span) => {
          try {
            const rows = await reviewContextModel.listDocumentActivity({
              agentId: targetAgentId,
              windowEnd: new Date(reviewWindowEnd),
              windowStart: new Date(reviewWindowStart),
            });
            const digest = mapNightlyDocumentActivityRows(rows);

            span.setAttribute('agent.signal.nightly.document_activity_row_count', rows.length);
            span.setAttribute(
              'agent.signal.nightly.document_skill_event_count',
              digest.skillBucket.length,
            );
            span.setStatus({ code: SpanStatusCode.OK });

            return digest;
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                error instanceof Error
                  ? error.message
                  : 'AgentSignal nightly document activity read failed',
            });
            span.recordException(error as Error);

            throw error;
          } finally {
            span.end();
          }
        },
      ),
    listFeedbackActivity: async ({ agentId: targetAgentId }) =>
      tracer.startActiveSpan(
        'agent_signal.nightly_review.collector.list_feedback_activity',
        {
          attributes: {
            'agent.signal.agent_id': targetAgentId,
            'agent.signal.user_id': userId,
          },
        },
        async (span): Promise<FeedbackActivityDigest> => {
          try {
            const digest: FeedbackActivityDigest = {
              neutralCount: 0,
              notSatisfied: [],
              satisfied: [],
            };

            span.setAttribute('agent.signal.nightly.feedback_satisfied_count', 0);
            span.setAttribute('agent.signal.nightly.feedback_not_satisfied_count', 0);
            span.setStatus({ code: SpanStatusCode.OK });

            return digest;
          } finally {
            span.end();
          }
        },
      ),
    listManagedSkills: async ({ agentId: targetAgentId, limit = 20 }) => {
      const skills = await skillDocumentService.listSkills({ agentId: targetAgentId });

      return skills.slice(0, limit).map<NightlyReviewManagedSkillSummary>((skill) => ({
        description: skill.description,
        documentId: skill.bundle.agentDocumentId,
        name: skill.name,
        readonly: false,
      }));
    },
    listProposalActivity: ({ agentId: targetAgentId }) =>
      listServerSelfReviewProposalActivity({
        agentId: targetAgentId,
        briefModel,
        userId,
      }),
    listRelevantMemories: async ({ limit = 20 }) => {
      const rows = await reviewContextModel.listRelevantMemories({ limit });

      return rows.map<NightlyReviewRelevantMemorySummary>((row) => ({
        content: row.content,
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
    listReceiptActivity: async ({ agentId: targetAgentId }) =>
      tracer.startActiveSpan(
        'agent_signal.nightly_review.collector.list_receipt_activity',
        {
          attributes: {
            'agent.signal.agent_id': targetAgentId,
            'agent.signal.user_id': userId,
          },
        },
        async (span): Promise<ReceiptActivityDigest> => {
          try {
            const digest: ReceiptActivityDigest = {
              appliedCount: 0,
              duplicateGroups: [],
              failedCount: 0,
              pendingProposalCount: 0,
              recentReceipts: [],
              reviewCount: 0,
            };

            span.setAttribute('agent.signal.nightly.receipt_pending_proposal_count', 0);
            span.setAttribute('agent.signal.nightly.receipt_recent_count', 0);
            span.setStatus({ code: SpanStatusCode.OK });

            return digest;
          } finally {
            span.end();
          }
        },
      ),
    listToolActivity: async ({ agentId: targetAgentId, reviewWindowEnd, reviewWindowStart }) =>
      tracer.startActiveSpan(
        'agent_signal.nightly_review.collector.list_tool_activity',
        {
          attributes: {
            'agent.signal.agent_id': targetAgentId,
            'agent.signal.user_id': userId,
          },
        },
        async (span) => {
          try {
            const rows = await reviewContextModel.listToolActivity({
              agentId: targetAgentId,
              windowEnd: new Date(reviewWindowEnd),
              windowStart: new Date(reviewWindowStart),
            });
            const digest = rows.map<ToolActivityDigest>((row) => ({
              apiName: row.apiName,
              failedCount: row.failedCount,
              firstUsedAt: row.firstUsedAt?.toISOString(),
              identifier: row.identifier,
              lastUsedAt: row.lastUsedAt?.toISOString(),
              messageIds: row.messageIds.slice(0, 10),
              sampleArgs: row.sampleArgs.slice(0, 3),
              sampleErrors: row.sampleErrors.slice(0, 3),
              topicIds: row.topicIds.slice(0, 10),
              totalCount: row.totalCount,
            }));

            span.setAttribute('agent.signal.nightly.tool_activity_count', digest.length);
            span.setStatus({ code: SpanStatusCode.OK });

            return digest;
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                error instanceof Error
                  ? error.message
                  : 'AgentSignal nightly tool activity read failed',
            });
            span.recordException(error as Error);

            throw error;
          } finally {
            span.end();
          }
        },
      ),
    listTopicActivity: async ({
      agentId: targetAgentId,
      limit = 90,
      reviewWindowEnd,
      reviewWindowStart,
    }) => {
      const rows = await reviewContextModel.listTopicActivity({
        agentId: targetAgentId,
        limit,
        windowEnd: new Date(reviewWindowEnd),
        windowStart: new Date(reviewWindowStart),
      });

      return rows.map<NightlyReviewTopicActivityRow>((row) => ({
        correctionCount: row.correctionCount,
        correctionIds: row.correctionIds,
        evidenceRefs: row.topicId ? [{ id: row.topicId, type: 'topic' }] : [],
        failedMessages: row.failedMessages,
        failedToolCount: row.failedToolCount,
        failedToolCalls: row.failedToolCalls,
        failureCount: row.failureCount,
        lastActivityAt: row.lastActivityAt.toISOString(),
        messageCount: row.messageCount,
        summary: row.summary,
        title: row.title ?? undefined,
        topicId: row.topicId ?? undefined,
      }));
    },
  });
  const briefWriter = createServerSelfReviewBriefWriter(db, userId);
  const resolveBriefTextTranslator = async ({ userId }: { userId: string }) => {
    const userInfo = await UserModel.getInfoForAIGeneration(db, userId);
    const { t } = await translation('home', userInfo.responseLanguage ?? 'en-US');

    return t;
  };

  return {
    acquireReviewGuard: (input) =>
      redisSourceEventStore.tryDedupe(
        `nightly-review-guard:${input.guardKey}`,
        AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds,
      ),
    canRunReview: async (input) => {
      if (!selfIterationEnabled) return false;
      if (input.userId !== userId) return false;
      if (agentId && input.agentId !== agentId) return false;
      if (!(await isAgentSignalEnabledForUser(db, userId))) return false;
      if (!(await reviewContextModel.canAgentRunSelfIteration(input.agentId))) return false;

      const targets = await nightlyReviewModel.listActiveAgentTargets(userId, {
        agentId: input.agentId,
        limit: 1,
        windowEnd: new Date(input.reviewWindowEnd),
        windowStart: new Date(input.reviewWindowStart),
      });

      return targets.length > 0;
    },
    collectContext: (input) => collector.collect(input),
    runSelfReviewAgent: async ({ context, localDate, sourceId, userId: runnerUserId }) => {
      const briefTextTranslator = await resolveBriefTextTranslator({ userId: runnerUserId });
      const modelRuntime = await initModelRuntimeFromDB(
        db,
        runnerUserId,
        DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
      );
      const toolSet = createServerToolSet({
        agentId: context.agentId,
        briefModel,
        briefTextTranslator,
        context,
        db,
        localDate: localDate ?? context.reviewWindowEnd.slice(0, 10),
        proposalBriefWriter: briefWriter,
        skillDocumentService,
        sourceId,
        userId: runnerUserId,
      });
      const selfReviewAgentRunner = createAgentRunner({
        maxSteps: 10,
        run: async ({ context, localDate, maxSteps, reviewScope, sourceId, tools, userId }) => {
          const runtimeResult = await executeSelfIteration({
            agentId: context.agentId,
            context,
            maxSteps,
            model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
            modelRuntime,
            sourceId,
            tools,
            userId,
          });
          const projected = projectRun({
            content: runtimeResult.content,
            localDate,
            outcomes: runtimeResult.writeOutcomes.map((outcome) => ({
              ...outcome.result,
              toolName: outcome.toolName,
            })),
            reviewScope,
            sourceId,
            toolCalls: runtimeResult.toolCalls,
            userId,
          });

          return {
            ...projected,
            stepCount: runtimeResult.stepCount,
          };
        },
        tools: toolSet,
      });

      return selfReviewAgentRunner.run({
        context,
        localDate,
        sourceId,
        userId: runnerUserId,
      });
    },
    resolveBriefTextTranslator,
    writeDailyBrief: (brief) => briefWriter.writeDailyBrief(brief),
    writeReceipts: (receipts) => persistAgentSignalReceipts(receipts),
  };
};
