import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';

import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { BriefModel } from '@/database/models/brief';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AGENT_SIGNAL_DEFAULTS } from '@/server/services/agentSignal/constants';
import { runMemoryActionAgent } from '@/server/services/agentSignal/policies/analyzeIntent/actions/userMemory';
import {
  createDurableSelfReflectionAccumulator,
  createProcedurePolicyOptions,
} from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';
import { redisSourceEventStore } from '@/server/services/agentSignal/store/adapters/redis/sourceEventStore';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { persistAgentSignalReceipts } from '../../receiptService';
import { createSelfReflectionService } from '../../selfReflection';
import { executeSelfIteration } from '../execute';
import { createSelfReviewProposalPreflightService } from '../review/proposalPreflight';
import { createSelfReviewProposalSnapshotService } from '../review/proposalSnapshot';
import type { CreateServerSelfIterationPolicyOptions } from '../server';
import { canRunSelfIterationSource, listServerSelfReviewProposalActivity } from '../server';
import type {
  OperationReservation,
  ReplaceSkillContentCASInput,
  ToolReceiptInput,
  ToolWriteResult,
} from '../tools/shared';
import { createMemoryService, createSkillManagementService, createToolSet } from '../tools/shared';
import { Risk } from '../types';
import type {
  CollectSelfReflectionContextInput,
  CreateSelfReflectionSourceHandlerDependencies,
  SelfReflectionReviewContext,
  SelfReflectionRuntimeFactory,
} from './handler';

const SELF_REFLECTION_OPERATION_STATE_TTL_SECONDS = AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds;

const selfReflectionOperationScopeKey = (idempotencyKey: string) =>
  `self-reflection-operation:${idempotencyKey}`;

const selfReflectionOperationReserveKey = (idempotencyKey: string) =>
  `self-reflection-operation-reserve:${idempotencyKey}`;

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

const reserveSelfReflectionOperation = async (
  idempotencyKey: string,
): Promise<OperationReservation> => {
  const scopeKey = selfReflectionOperationScopeKey(idempotencyKey);
  const existing = parseStoredOperationResult(await redisSourceEventStore.readWindow(scopeKey));

  if (existing) return { existing, reserved: false };

  const reserved = await redisSourceEventStore.tryDedupe(
    selfReflectionOperationReserveKey(idempotencyKey),
    SELF_REFLECTION_OPERATION_STATE_TTL_SECONDS,
  );

  if (reserved) return { reserved: true };

  return {
    existing: parseStoredOperationResult(await redisSourceEventStore.readWindow(scopeKey)) ?? {
      status: 'skipped_unsupported',
      summary:
        'Self-reflection operation is already reserved or Redis is unavailable; skipped to avoid duplicate mutation.',
    },
    reserved: false,
  };
};

const completeSelfReflectionOperation = async (input: ToolReceiptInput) => {
  await redisSourceEventStore.writeWindow(
    selfReflectionOperationScopeKey(input.idempotencyKey),
    {
      result: JSON.stringify({
        ...(input.receiptId ? { receiptId: input.receiptId } : {}),
        ...(input.resourceId ? { resourceId: input.resourceId } : {}),
        status: input.status,
        ...(input.summary ? { summary: input.summary } : {}),
      } satisfies ToolWriteResult),
    },
    SELF_REFLECTION_OPERATION_STATE_TTL_SECONDS,
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

const writeSelfReflectionToolReceipt = async ({
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
      detail:
        input.summary ?? `Self-reflection tool ${input.toolName} finished with ${input.status}.`,
      id: input.idempotencyKey,
      kind:
        input.toolName === 'createSkillIfAbsent' || input.toolName === 'replaceSkillContentCAS'
          ? 'skill'
          : 'review',
      metadata: {
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
      },
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
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
      title: input.summary ?? 'Self-reflection tool outcome',
      topicId: sourceId,
      userId,
    },
  ]);

  return { receiptId: input.idempotencyKey };
};

const collectSelfReflectionContext = async (
  reviewContextModel: AgentSignalReviewContextModel,
  input: CollectSelfReflectionContextInput,
): Promise<SelfReflectionReviewContext> => {
  const topicIds =
    input.scopeType === 'topic' || input.topicId
      ? [input.topicId ?? input.scopeId].filter((value): value is string => Boolean(value))
      : [];
  const rows = topicIds.length
    ? await reviewContextModel.listSelfReflectionTopicActivity({
        agentId: input.agentId,
        topicId: topicIds[0],
        windowEnd: new Date(input.windowEnd),
        windowStart: new Date(input.windowStart),
      })
    : [];

  return {
    ...input,
    evidenceRefs: [
      {
        id: input.scopeId,
        type: input.scopeType,
      },
    ],
    topics: rows.map((row) => ({
      evidenceRefs: row.topicId ? [{ id: row.topicId, type: 'topic' }] : [],
      failedToolCount: row.failedToolCount,
      failureCount: row.failureCount,
      lastActivityAt: row.lastActivityAt?.toISOString(),
      messageCount: row.messageCount,
      summary: row.summary,
      title: row.title ?? undefined,
      topicId: row.topicId ?? undefined,
    })),
  };
};

const toReadonlyArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const createReflectionEvidenceDigest = ({
  context,
  evidenceIds,
}: {
  context: SelfReflectionReviewContext;
  evidenceIds?: string[];
}) => {
  const selectedEvidenceIds = new Set(evidenceIds ?? []);
  const includeAll = selectedEvidenceIds.size === 0;
  const topics = toReadonlyArray(context.topics).filter((topic) => {
    if (includeAll) return true;
    if (!topic || typeof topic !== 'object') return false;

    const refs = 'evidenceRefs' in topic ? toReadonlyArray(topic.evidenceRefs) : [];

    return refs.some(
      (ref) =>
        ref &&
        typeof ref === 'object' &&
        'id' in ref &&
        typeof ref.id === 'string' &&
        selectedEvidenceIds.has(ref.id),
    );
  });

  return {
    evidenceRefs: context.evidenceRefs,
    scope: {
      id: context.scopeId,
      type: context.scopeType,
    },
    topics,
  };
};

const createReflectionRuntimeTools = ({
  agentId,
  briefModel,
  context,
  db,
  skillDocumentService,
  sourceId,
  userId,
}: {
  agentId: string;
  briefModel: BriefModel;
  context: SelfReflectionReviewContext;
  db: LobeChatDatabase;
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
  const skillService = createSkillManagementService({
    createSkill: async ({ input }) => {
      const result = await skillDocumentService.createSkill({
        agentId,
        bodyMarkdown: input.bodyMarkdown ?? '',
        description: input.description ?? 'Agent Signal managed skill.',
        name: input.name ?? input.title ?? 'agent-signal-skill',
        title: input.title ?? input.name ?? 'Agent Signal skill',
      });

      return {
        skillDocumentId: result.bundle.agentDocumentId,
        summary: `Created managed skill ${result.name}.`,
      };
    },
    refineSkill: async ({ input }) => {
      const result = await skillDocumentService.replaceSkillIndex({
        agentDocumentId: input.skillDocumentId,
        agentId,
        bodyMarkdown: input.bodyMarkdown ?? '',
      });

      if (!result) throw new Error('Skill target not found');

      return {
        skillDocumentId: result.bundle.agentDocumentId,
        summary: `Refined managed skill ${result.name}.`,
      };
    },
  });

  return createToolSet({
    completeOperation: completeSelfReflectionOperation,
    completeReplaceSkillInput: async (input: ReplaceSkillContentCASInput) => {
      const baseSnapshot = await proposalSnapshot.captureActionSnapshot({
        actionType: 'refine_skill',
        agentId,
        input: { skillDocumentId: input.skillDocumentId },
        userId,
      });

      return {
        ...input,
        baseSnapshot,
        skillDocumentId: baseSnapshot.agentDocumentId ?? input.skillDocumentId,
      };
    },
    createSkill: async (input) => {
      const result = await skillService.createSkill({
        evidenceRefs: [],
        idempotencyKey: input.idempotencyKey,
        input,
      });

      return {
        resourceId: result.skillDocumentId,
        summary: result.summary,
      };
    },
    getEvidenceDigest: async ({ evidenceIds }) =>
      createReflectionEvidenceDigest({ context, evidenceIds }),
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
        const preflight = await proposalPreflight.checkAction({
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

        return preflight.allowed ? { allowed: true } : { allowed: false, reason: preflight.reason };
      }

      return { allowed: true };
    },
    readProposal: async ({ proposalId, proposalKey }) => {
      const digest = await listServerSelfReviewProposalActivity({ agentId, briefModel, userId });

      return digest.active.find(
        (proposal) =>
          (proposalId && proposal.proposalId === proposalId) ||
          (proposalKey && proposal.proposalKey === proposalKey),
      );
    },
    replaceSkill: async (input) => {
      const result = await skillService.refineSkill({
        evidenceRefs: [],
        idempotencyKey: input.idempotencyKey,
        input,
      });

      return {
        resourceId: result.skillDocumentId,
        summary: result.summary,
      };
    },
    reserveOperation: reserveSelfReflectionOperation,
    writeMemory: async (input) => {
      const memoryService = createMemoryService({
        writeMemory: async ({ content, evidenceRefs, idempotencyKey }) => {
          const result = await runMemoryActionAgent(
            {
              agentId,
              message: content,
              reason: `Agent Signal self-reflection memory candidate from ${evidenceRefs.length} evidence refs.`,
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
    writeReceipt: (input) => writeSelfReflectionToolReceipt({ agentId, input, sourceId, userId }),
  });
};

/**
 * Creates source-scoped runtime dependencies for server self-reflection runs.
 *
 * Call stack:
 *
 * createServerSelfReflectionPolicyOptions
 *   -> {@link SelfReflectionServerRuntimeFactory.createRuntime}
 *     -> {@link executeSelfIteration}
 *       -> self-reflection tools and receipt persistence
 *
 * Use when:
 * - The Agent Signal workflow consumes `agent.self_reflection.requested`
 * - Reflection needs source-scoped evidence tools rather than nightly brief proposal tools
 *
 * Expects:
 * - `context` was collected for the same source payload
 * - Tools are scoped to one user/agent/source id
 *
 * Returns:
 * - Model runtime, toolset, and executor callback for one reflection run
 */
export class SelfReflectionServerRuntimeFactory implements SelfReflectionRuntimeFactory {
  constructor(
    private readonly input: {
      agentId: string;
      briefModel: BriefModel;
      db: LobeChatDatabase;
      skillDocumentService: SkillManagementDocumentService;
      userId: string;
    },
  ) {}

  async createRuntime({
    context,
    source,
  }: Parameters<SelfReflectionRuntimeFactory['createRuntime']>[0]) {
    const modelRuntime = await initModelRuntimeFromDB(
      this.input.db,
      this.input.userId,
      DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    );

    return {
      executeSelfIteration,
      model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      modelRuntime,
      tools: createReflectionRuntimeTools({
        agentId: this.input.agentId,
        briefModel: this.input.briefModel,
        context,
        db: this.input.db,
        skillDocumentService: this.input.skillDocumentService,
        sourceId: source.sourceId,
        userId: this.input.userId,
      }),
    };
  }
}

/**
 * Creates server runtime handlers for immediate self-feedback reflection sources.
 *
 * Call stack:
 *
 * runAgentSignalWorkflow
 *   -> {@link createServerSelfReflectionPolicyOptions}
 *     -> reflection source handler dependencies
 *       -> {@link SelfReflectionServerRuntimeFactory}
 *
 * Use when:
 * - The Agent Signal workflow consumes `agent.self_reflection.requested`
 * - Runtime policy composition needs scoped collection, self-iteration executor, and receipts
 *
 * Expects:
 * - The source was emitted by the self-reflection request service
 * - The handler will re-check gates and idempotency before reviewer work
 *
 * Returns:
 * - Self-reflection handler options ready for `createDefaultAgentSignalPolicies`
 */
export const createServerSelfReflectionPolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
}: CreateServerSelfIterationPolicyOptions): CreateSelfReflectionSourceHandlerDependencies => {
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId);
  const briefModel = new BriefModel(db, userId);
  const skillDocumentService = new SkillManagementDocumentService(db, userId);
  const targetAgentId = agentId ?? '';

  return {
    acquireReviewGuard: (input) =>
      redisSourceEventStore.tryDedupe(
        `self-reflection-guard:${input.guardKey}`,
        AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds,
      ),
    canRunReview: async (input) => {
      if (input.userId !== userId) return false;

      return canRunSelfIterationSource({
        agentId: input.agentId,
        expectedAgentId: agentId,
        reviewContextModel,
        selfIterationEnabled,
      });
    },
    collectContext: (input) => collectSelfReflectionContext(reviewContextModel, input),
    runtimeFactory: new SelfReflectionServerRuntimeFactory({
      agentId: targetAgentId,
      briefModel,
      db,
      skillDocumentService,
      userId,
    }),
    writeReceipt: async () => {},
    writeReceipts: (receipts) => persistAgentSignalReceipts(receipts),
  };
};

/**
 * Creates server procedure policy options with fast-loop self-reflection enabled.
 *
 * Call stack:
 *
 * runAgentSignalWorkflow
 *   -> {@link createServerProcedurePolicyOptions}
 *     -> {@link createProcedurePolicyOptions}
 *       -> durable weak-signal self-reflection accumulator
 *
 * Use when:
 * - Workflow-owned Agent Signal runtimes process tool outcome sources
 * - Repeated tool failures should enqueue scoped self-reflection request sources
 *
 * Expects:
 * - The same Redis policy-state store is shared with procedure records and accumulators
 * - Feature gates are re-checked before the request source is enqueued
 *
 * Returns:
 * - Procedure policy options ready for procedure-aware Agent Signal policies
 */
export const createServerProcedurePolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
}: CreateServerSelfIterationPolicyOptions) => {
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId);

  return createProcedurePolicyOptions({
    policyStateStore: redisPolicyStateStore,
    selfReflection: {
      accumulator: createDurableSelfReflectionAccumulator({
        policyStateStore: redisPolicyStateStore,
        ttlSeconds: 7 * 24 * 60 * 60,
      }),
      getWindowStart: ({ decision, source }) =>
        decision.windowStart ?? new Date(source.timestamp).toISOString(),
      service: createSelfReflectionService({
        canRequestSelfReflection: async (input) => {
          if (input.userId !== userId) return false;

          return canRunSelfIterationSource({
            agentId: input.agentId,
            expectedAgentId: agentId,
            reviewContextModel,
            selfIterationEnabled,
          });
        },
        enqueueSource: async (event) => {
          const { enqueueAgentSignalSourceEvent } =
            await import('@/server/services/agentSignal/emitter');

          return enqueueAgentSignalSourceEvent(event, {
            agentId,
            userId,
          });
        },
      }),
      userId,
    },
    ttlSeconds: 7 * 24 * 60 * 60,
  });
};
