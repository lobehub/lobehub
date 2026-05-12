import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';

import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AGENT_SIGNAL_DEFAULTS } from '@/server/services/agentSignal/constants';
import { runMemoryActionAgent } from '@/server/services/agentSignal/policies/analyzeIntent/actions/userMemory';
import { redisSourceEventStore } from '@/server/services/agentSignal/store/adapters/redis/sourceEventStore';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { persistAgentSignalReceipts } from '../../receiptService';
import { executeSelfIteration } from '../execute';
import { createSelfReviewProposalPreflightService } from '../review/proposalPreflight';
import { createSelfReviewProposalSnapshotService } from '../review/proposalSnapshot';
import type { CreateServerSelfIterationPolicyOptions } from '../server';
import { canRunSelfIterationSource } from '../server';
import type {
  OperationReservation,
  ReplaceSkillContentCASInput,
  ToolReceiptInput,
  ToolWriteResult,
} from '../tools/shared';
import { createMemoryService, createSkillManagementService, createToolSet } from '../tools/shared';
import { Risk } from '../types';
import type {
  CreateSelfFeedbackIntentSourceHandlerDependencies,
  SelfFeedbackIntentEvidenceEnrichment,
  SelfFeedbackIntentRuntimeFactory,
} from './handler';

const SELF_FEEDBACK_INTENT_OPERATION_STATE_TTL_SECONDS = AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds;

const selfFeedbackIntentOperationScopeKey = (idempotencyKey: string) =>
  `self-feedback-intent-operation:${idempotencyKey}`;

const selfFeedbackIntentOperationReserveKey = (idempotencyKey: string) =>
  `self-feedback-intent-operation-reserve:${idempotencyKey}`;

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

const reserveSelfFeedbackIntentOperation = async (
  idempotencyKey: string,
): Promise<OperationReservation> => {
  const scopeKey = selfFeedbackIntentOperationScopeKey(idempotencyKey);
  const existing = parseStoredOperationResult(await redisSourceEventStore.readWindow(scopeKey));

  if (existing) return { existing, reserved: false };

  const reserved = await redisSourceEventStore.tryDedupe(
    selfFeedbackIntentOperationReserveKey(idempotencyKey),
    SELF_FEEDBACK_INTENT_OPERATION_STATE_TTL_SECONDS,
  );

  if (reserved) return { reserved: true };

  return {
    existing: parseStoredOperationResult(await redisSourceEventStore.readWindow(scopeKey)) ?? {
      status: 'skipped_unsupported',
      summary:
        'Self-iteration intent operation is already reserved or Redis is unavailable; skipped to avoid duplicate mutation.',
    },
    reserved: false,
  };
};

const completeSelfFeedbackIntentOperation = async (input: ToolReceiptInput) => {
  await redisSourceEventStore.writeWindow(
    selfFeedbackIntentOperationScopeKey(input.idempotencyKey),
    {
      result: JSON.stringify({
        ...(input.receiptId ? { receiptId: input.receiptId } : {}),
        ...(input.resourceId ? { resourceId: input.resourceId } : {}),
        status: input.status,
        ...(input.summary ? { summary: input.summary } : {}),
      } satisfies ToolWriteResult),
    },
    SELF_FEEDBACK_INTENT_OPERATION_STATE_TTL_SECONDS,
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

const writeSelfFeedbackIntentToolReceipt = async ({
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
        input.summary ??
        `Self-iteration intent tool ${input.toolName} finished with ${input.status}.`,
      id: input.idempotencyKey,
      kind:
        input.toolName === 'createSkillIfAbsent' || input.toolName === 'replaceSkillContentCAS'
          ? 'skill'
          : 'review',
      metadata: {
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
      },
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
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
      title: input.summary ?? 'Self-iteration intent tool outcome',
      topicId: sourceId,
      userId,
    },
  ]);

  return { receiptId: input.idempotencyKey };
};

const createIntentEvidenceDigest = ({
  enrichment,
  payload,
  sourceId,
}: {
  enrichment: SelfFeedbackIntentEvidenceEnrichment;
  payload: Parameters<SelfFeedbackIntentRuntimeFactory['createRuntime']>[0]['payload'];
  sourceId: string;
}) => ({
  evidenceRefs: [...payload.evidenceRefs, ...enrichment.evidenceRefs],
  intent: payload,
  scope: {
    id: payload.scopeId,
    type: payload.scopeType,
  },
  sourceId,
});

const createIntentRuntimeTools = ({
  agentId,
  db,
  enrichment,
  payload,
  skillDocumentService,
  sourceId,
  userId,
}: {
  agentId: string;
  db: LobeChatDatabase;
  enrichment: SelfFeedbackIntentEvidenceEnrichment;
  payload: Parameters<SelfFeedbackIntentRuntimeFactory['createRuntime']>[0]['payload'];
  skillDocumentService: SkillManagementDocumentService;
  sourceId: string;
  userId: string;
}) => {
  const evidenceRefs = createIntentEvidenceDigest({ enrichment, payload, sourceId }).evidenceRefs;
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
    completeOperation: completeSelfFeedbackIntentOperation,
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
        evidenceRefs,
        idempotencyKey: input.idempotencyKey,
        input,
      });

      return {
        resourceId: result.skillDocumentId,
        summary: result.summary,
      };
    },
    getEvidenceDigest: async () =>
      createIntentEvidenceDigest({
        enrichment,
        payload,
        sourceId,
      }),
    getManagedSkill: ({ agentId: targetAgentId, skillDocumentId }) =>
      skillDocumentService.getSkill({
        agentDocumentId: skillDocumentId,
        agentId: targetAgentId,
        includeContent: true,
      }),
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
    replaceSkill: async (input) => {
      const result = await skillService.refineSkill({
        evidenceRefs,
        idempotencyKey: input.idempotencyKey,
        input,
      });

      return {
        resourceId: result.skillDocumentId,
        summary: result.summary,
      };
    },
    reserveOperation: reserveSelfFeedbackIntentOperation,
    writeMemory: async (input) => {
      const memoryService = createMemoryService({
        writeMemory: async ({ content, evidenceRefs, idempotencyKey }) => {
          const result = await runMemoryActionAgent(
            {
              agentId,
              message: content,
              reason: `Agent Signal self-feedback intent memory candidate from ${evidenceRefs.length} evidence refs.`,
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
    writeReceipt: (input) =>
      writeSelfFeedbackIntentToolReceipt({ agentId, input, sourceId, userId }),
  });
};

/**
 * Creates source-scoped runtime dependencies for server self-feedback intent runs.
 *
 * Call stack:
 *
 * createServerSelfFeedbackIntentPolicyOptions
 *   -> {@link SelfFeedbackIntentServerRuntimeFactory.createRuntime}
 *     -> {@link executeSelfIteration}
 *       -> self-feedback intent tools and receipt persistence
 *
 * Use when:
 * - The Agent Signal workflow consumes `agent.self_feedback_intent.declared`
 * - Declared agent feedback must use the self-iteration executor instead of legacy planner/executor
 *
 * Expects:
 * - The handler has already validated the source payload and guard
 * - Tools are scoped to one user/agent/source id
 *
 * Returns:
 * - Model runtime, toolset, and executor callback for one intent run
 */
export class SelfFeedbackIntentServerRuntimeFactory implements SelfFeedbackIntentRuntimeFactory {
  constructor(
    private readonly input: {
      db: LobeChatDatabase;
      skillDocumentService: SkillManagementDocumentService;
      userId: string;
    },
  ) {}

  async createRuntime({
    enrichment,
    payload,
    source,
  }: Parameters<SelfFeedbackIntentRuntimeFactory['createRuntime']>[0]) {
    const modelRuntime = await initModelRuntimeFromDB(
      this.input.db,
      this.input.userId,
      DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    );

    return {
      executeSelfIteration,
      model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      modelRuntime,
      tools: createIntentRuntimeTools({
        agentId: payload.agentId,
        db: this.input.db,
        enrichment,
        payload,
        skillDocumentService: this.input.skillDocumentService,
        sourceId: source.sourceId,
        userId: this.input.userId,
      }),
    };
  }
}

/**
 * Creates server runtime handlers for agent-declared self-feedback intent sources.
 *
 * Call stack:
 *
 * runAgentSignalWorkflow
 *   -> {@link createServerSelfFeedbackIntentPolicyOptions}
 *     -> intent source handler dependencies
 *       -> {@link SelfFeedbackIntentServerRuntimeFactory}
 *
 * Use when:
 * - The Agent Signal workflow consumes `agent.self_feedback_intent.declared`
 * - Runtime policy composition needs scoped shared execution and receipts
 *
 * Expects:
 * - The source was emitted by `declareSelfFeedbackIntent`
 * - The handler will re-check gates and idempotency before reviewer work
 *
 * Returns:
 * - Intent handler options ready for `createDefaultAgentSignalPolicies`
 */
export const createServerSelfFeedbackIntentPolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
}: CreateServerSelfIterationPolicyOptions): CreateSelfFeedbackIntentSourceHandlerDependencies => {
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId);
  const skillDocumentService = new SkillManagementDocumentService(db, userId);

  return {
    acquireReviewGuard: (input) =>
      redisSourceEventStore.tryDedupe(
        `self-feedback-intent-guard:${input.guardKey}`,
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
    enrichEvidence: async (input) => ({
      evidenceRefs: [
        {
          id: input.scopeId,
          type: input.scopeType,
        },
      ],
    }),
    runtimeFactory: new SelfFeedbackIntentServerRuntimeFactory({
      db,
      skillDocumentService,
      userId,
    }),
    writeReceipt: async () => {},
    writeReceipts: (receipts) => persistAgentSignalReceipts(receipts),
  };
};
