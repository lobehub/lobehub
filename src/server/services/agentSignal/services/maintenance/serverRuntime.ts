import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { createAgentSignalNightlyReviewMessages } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { z } from 'zod';

import { AgentSignalNightlyReviewModel } from '@/database/models/agentSignal/nightlyReview';
import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { isAgentSignalEnabledForUser } from '@/server/services/agentSignal/featureGate';
import { runMemoryActionAgent } from '@/server/services/agentSignal/policies/analyzeIntent/actions/userMemory';
import type { CreateNightlyReviewSourceHandlerDependencies } from '@/server/services/agentSignal/policies/reviewNightly/nightlyReview';
import type { CreateSelfIterationIntentSourceHandlerDependencies } from '@/server/services/agentSignal/policies/reviewNightly/selfIterationIntent';
import type {
  CollectSelfReflectionContextInput,
  CreateSelfReflectionSourceHandlerDependencies,
  SelfReflectionReviewContext,
} from '@/server/services/agentSignal/policies/reviewNightly/selfReflection';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { AGENT_SIGNAL_DEFAULTS } from '../../constants';
import {
  createDurableSelfReflectionAccumulator,
  createProcedurePolicyOptions,
} from '../../procedure';
import { redisPolicyStateStore } from '../../store/adapters/redis/policyStateStore';
import { redisSourceEventStore } from '../../store/adapters/redis/sourceEventStore';
import { persistAgentSignalReceipts } from '../receiptService';
import { createSelfReflectionService } from '../selfReflection';
import { createMaintenanceExecutorService } from './executor';
import { createMemoryMaintenanceService } from './memory';
import type {
  NightlyReviewContext,
  NightlyReviewManagedSkillSummary,
  NightlyReviewRelevantMemorySummary,
  NightlyReviewTopicActivityRow,
} from './nightlyCollector';
import { createNightlyReviewService } from './nightlyCollector';
import { createMaintenancePlannerService } from './planner';
import { createSkillManagementService } from './skill';
import type { MaintenanceActionDraft, MaintenancePlanDraft } from './types';

// NOTICE:
// This schema is intentionally hand-authored for `generateObject` structured output.
// Zod-generated JSON Schema is not compatible enough here: strict model schemas need
// exact `required`, `additionalProperties`, enum, and nullable shapes. Keep the Zod
// parser below as the server-side validation boundary instead of deriving this schema.
const NIGHTLY_REVIEW_AGENT_SCHEMA = {
  name: 'agent_signal_nightly_self_review',
  schema: {
    additionalProperties: false,
    properties: {
      actions: {
        items: {
          additionalProperties: false,
          properties: {
            actionType: {
              enum: [
                'write_memory',
                'create_skill',
                'refine_skill',
                'consolidate_skill',
                'noop',
                'proposal_only',
              ],
              type: 'string',
            },
            confidence: { maximum: 1, minimum: 0, type: 'number' },
            evidenceRefs: {
              items: {
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  summary: { type: 'string' },
                  type: {
                    enum: [
                      'topic',
                      'message',
                      'operation',
                      'source',
                      'receipt',
                      'tool_call',
                      'task',
                      'agent_document',
                      'memory',
                    ],
                    type: 'string',
                  },
                },
                required: ['id', 'type'],
                type: 'object',
              },
              type: 'array',
            },
            policyHints: {
              additionalProperties: false,
              properties: {
                evidenceStrength: { enum: ['weak', 'medium', 'strong'], type: 'string' },
                mutationScope: { enum: ['small', 'broad'], type: 'string' },
                persistence: { enum: ['stable', 'temporal'], type: 'string' },
                sensitivity: { enum: ['normal', 'sensitive'], type: 'string' },
                userExplicitness: { enum: ['explicit', 'implicit', 'inferred'], type: 'string' },
              },
              type: 'object',
            },
            rationale: { type: 'string' },
            target: {
              additionalProperties: false,
              properties: {
                memoryId: { type: 'string' },
                skillDocumentId: { type: 'string' },
                skillName: { type: 'string' },
                targetReadonly: { type: 'boolean' },
                taskIds: { items: { type: 'string' }, type: 'array' },
                topicIds: { items: { type: 'string' }, type: 'array' },
              },
              type: 'object',
            },
            value: { type: ['object', 'string', 'null'] },
          },
          required: ['actionType', 'confidence', 'evidenceRefs', 'rationale'],
          type: 'object',
        },
        type: 'array',
      },
      findings: {
        items: {
          additionalProperties: false,
          properties: {
            evidenceRefs: {
              items: {
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  summary: { type: 'string' },
                  type: { type: 'string' },
                },
                required: ['id', 'type'],
                type: 'object',
              },
              type: 'array',
            },
            severity: { enum: ['high', 'low', 'medium'], type: 'string' },
            summary: { type: 'string' },
          },
          required: ['evidenceRefs', 'severity', 'summary'],
          type: 'object',
        },
        type: 'array',
      },
      summary: { type: 'string' },
    },
    required: ['actions', 'findings', 'summary'],
    type: 'object',
  },
  strict: true,
} satisfies GenerateObjectSchema;

// Runtime parser for model output after structured generation. This mirrors the
// model-facing schema above, but the two schemas serve different boundaries.
const EvidenceRefSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  type: z.enum([
    'topic',
    'message',
    'operation',
    'source',
    'receipt',
    'tool_call',
    'task',
    'agent_document',
    'memory',
  ]),
});

const MaintenanceActionDraftSchema = z.object({
  actionType: z.enum([
    'write_memory',
    'create_skill',
    'refine_skill',
    'consolidate_skill',
    'noop',
    'proposal_only',
  ]),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(EvidenceRefSchema),
  policyHints: z
    .object({
      evidenceStrength: z.enum(['weak', 'medium', 'strong']).optional(),
      mutationScope: z.enum(['small', 'broad']).optional(),
      persistence: z.enum(['stable', 'temporal']).optional(),
      sensitivity: z.enum(['normal', 'sensitive']).optional(),
      userExplicitness: z.enum(['explicit', 'implicit', 'inferred']).optional(),
    })
    .optional(),
  rationale: z.string(),
  target: z
    .object({
      memoryId: z.string().optional(),
      skillDocumentId: z.string().optional(),
      skillName: z.string().optional(),
      targetReadonly: z.boolean().optional(),
      taskIds: z.array(z.string()).optional(),
      topicIds: z.array(z.string()).optional(),
    })
    .optional(),
  value: z.unknown().optional(),
}) satisfies z.ZodType<MaintenanceActionDraft>;

const MaintenancePlanDraftSchema = z.object({
  actions: z.array(MaintenanceActionDraftSchema),
  findings: z.array(
    z.object({
      evidenceRefs: z.array(EvidenceRefSchema),
      severity: z.enum(['high', 'low', 'medium']),
      summary: z.string(),
    }),
  ),
  summary: z.string(),
}) satisfies z.ZodType<MaintenancePlanDraft>;

const getStringField = (value: unknown, key: string) => {
  if (!value || typeof value !== 'object') return undefined;

  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim().length > 0 ? field.trim() : undefined;
};

const createSkillNameFromTitle = (title: string | undefined) =>
  (title ?? 'agent-signal-skill')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 48) || 'agent-signal-skill';

/**
 * Options for composing server maintenance policy handlers.
 */
export interface CreateServerMaintenancePolicyOptions {
  /** Agent id from the workflow payload, used as an extra ownership check. */
  agentId?: string;
  /** Database bound to the current workflow worker. */
  db: LobeChatDatabase;
  /**
   * User-level Agent Signal gate computed by workflow normalization.
   *
   * @default false
   */
  selfIterationEnabled?: boolean;
  /** User id from the workflow payload. */
  userId: string;
}

const createServerMaintenanceExecutor = (input: {
  agentId?: string;
  db: LobeChatDatabase;
  skillDocumentService: SkillManagementDocumentService;
  userId: string;
}) => {
  return createMaintenanceExecutorService({
    memory: createMemoryMaintenanceService({
      writeMemory: async ({ content, evidenceRefs, idempotencyKey }) => {
        const result = await runMemoryActionAgent(
          {
            agentId: input.agentId,
            message: content,
            reason: `Agent Signal maintenance memory candidate from ${evidenceRefs.length} evidence refs.`,
          },
          {
            db: input.db,
            userId: input.userId,
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
    }),
    skill: createSkillManagementService({
      createSkill: async ({ input: skillInput }) => {
        const bodyMarkdown =
          getStringField(skillInput, 'bodyMarkdown') ?? getStringField(skillInput, 'content') ?? '';
        const title = getStringField(skillInput, 'title') ?? getStringField(skillInput, 'name');
        const result = await input.skillDocumentService.createSkill({
          agentId: input.agentId ?? '',
          bodyMarkdown,
          description: getStringField(skillInput, 'description') ?? 'Agent Signal managed skill.',
          name: createSkillNameFromTitle(getStringField(skillInput, 'name') ?? title),
          title: title ?? 'Agent Signal skill',
        });

        return {
          skillDocumentId: result.bundle.agentDocumentId,
          summary: `Created managed skill ${result.name}.`,
        };
      },
      refineSkill: async ({ input: skillInput }) => {
        const bodyMarkdown =
          getStringField(skillInput, 'bodyMarkdown') ??
          getStringField(skillInput, 'patch') ??
          getStringField(skillInput, 'content') ??
          '';
        const result = await input.skillDocumentService.replaceSkillIndex({
          agentId: input.agentId ?? '',
          agentDocumentId: skillInput.skillDocumentId,
          bodyMarkdown,
          description: getStringField(skillInput, 'description'),
        });

        if (!result) throw new Error('Skill target not found');

        return {
          skillDocumentId: result.bundle.agentDocumentId,
          summary: `Refined managed skill ${result.name}.`,
        };
      },
    }),
  });
};

const canRunMaintenanceReview = async (input: {
  agentId: string;
  expectedAgentId?: string;
  reviewContextModel: AgentSignalReviewContextModel;
  selfIterationEnabled: boolean;
}) => {
  if (!input.selfIterationEnabled) return false;
  if (input.expectedAgentId && input.agentId !== input.expectedAgentId) return false;

  return input.reviewContextModel.canAgentRunSelfIteration(input.agentId);
};

const runServerMaintenanceReviewAgent = async (
  db: LobeChatDatabase,
  userId: string,
  context: NightlyReviewContext | SelfReflectionReviewContext,
) => {
  const modelRuntime = await initModelRuntimeFromDB(
    db,
    userId,
    DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
  );
  const result = await modelRuntime.generateObject(
    {
      messages: createAgentSignalNightlyReviewMessages(context),
      model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      schema: NIGHTLY_REVIEW_AGENT_SCHEMA,
    },
    { metadata: { trigger: RequestTrigger.AgentSignal } },
  );

  return MaintenancePlanDraftSchema.parse(result);
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

/**
 * Creates server runtime handlers for the self-reflection source handler.
 *
 * Use when:
 * - The Agent Signal workflow consumes `agent.self_reflection.requested`
 * - Runtime policy composition needs scoped collection, reviewer, planner, executor, and receipts
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
}: CreateServerMaintenancePolicyOptions): CreateSelfReflectionSourceHandlerDependencies => {
  const planner = createMaintenancePlannerService();
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId);
  const skillDocumentService = new SkillManagementDocumentService(db, userId);
  const executor = createServerMaintenanceExecutor({
    agentId,
    db,
    skillDocumentService,
    userId,
  });

  return {
    acquireReviewGuard: (input) =>
      redisSourceEventStore.tryDedupe(
        `self-reflection-guard:${input.guardKey}`,
        AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds,
      ),
    canRunReview: async (input) => {
      if (input.userId !== userId) return false;

      return canRunMaintenanceReview({
        agentId: input.agentId,
        expectedAgentId: agentId,
        reviewContextModel,
        selfIterationEnabled,
      });
    },
    collectContext: (input) => collectSelfReflectionContext(reviewContextModel, input),
    executePlan: (plan) => executor.execute(plan),
    planReviewOutput: (request) => planner.plan(request),
    runMaintenanceReviewAgent: (context) => runServerMaintenanceReviewAgent(db, userId, context),
    writeReceipt: async () => {},
    writeReceipts: (receipts) => persistAgentSignalReceipts(receipts),
  };
};

/**
 * Creates server runtime handlers for the agent-declared self-iteration intent source handler.
 *
 * Use when:
 * - The Agent Signal workflow consumes `agent.self_iteration_intent.declared`
 * - Runtime policy composition needs declared intents to pass through deterministic planning
 *
 * Expects:
 * - The source was emitted by `declareSelfIterationIntent`
 * - The handler will re-check gates and idempotency before execution
 *
 * Returns:
 * - Self-iteration intent handler options ready for `createDefaultAgentSignalPolicies`
 */
export const createServerSelfIterationIntentPolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
}: CreateServerMaintenancePolicyOptions): CreateSelfIterationIntentSourceHandlerDependencies => {
  const planner = createMaintenancePlannerService();
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId);
  const skillDocumentService = new SkillManagementDocumentService(db, userId);
  const executor = createServerMaintenanceExecutor({
    agentId,
    db,
    skillDocumentService,
    userId,
  });

  return {
    acquireReviewGuard: (input) =>
      redisSourceEventStore.tryDedupe(
        `self-iteration-intent-guard:${input.guardKey}`,
        AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds,
      ),
    canRunReview: async (input) => {
      if (input.userId !== userId) return false;

      return canRunMaintenanceReview({
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
    executePlan: (plan) => executor.execute(plan),
    planReviewOutput: (request) => planner.plan(request),
    writeReceipt: async () => {},
    writeReceipts: (receipts) => persistAgentSignalReceipts(receipts),
  };
};

/**
 * Creates server procedure policy options with fast-loop self-reflection enabled.
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
 * - Procedure policy options ready for `createAnalyzeIntentPolicy`
 */
export const createServerProcedurePolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
}: CreateServerMaintenancePolicyOptions) => {
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

          return canRunMaintenanceReview({
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
    },
    ttlSeconds: 7 * 24 * 60 * 60,
  });
};

/**
 * Creates server runtime handlers for the nightly review source handler.
 *
 * Use when:
 * - The Agent Signal workflow consumes `agent.nightly_review.requested`
 * - Runtime policy composition needs collection, review, planning, execution, receipts, and brief writing
 *
 * Expects:
 * - The scheduler has already emitted a stable nightly source id
 * - The handler will re-check feature gates and idempotency before reviewer work
 *
 * Returns:
 * - Nightly review handler options ready for `createDefaultAgentSignalPolicies`
 */
export const createServerNightlyReviewPolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
}: CreateServerMaintenancePolicyOptions): CreateNightlyReviewSourceHandlerDependencies => {
  const planner = createMaintenancePlannerService();
  const nightlyReviewModel = new AgentSignalNightlyReviewModel(db);
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId);
  const skillDocumentService = new SkillManagementDocumentService(db, userId);
  const collector = createNightlyReviewService({
    listManagedSkills: async ({ agentId: targetAgentId, limit = 20 }) => {
      const skills = await skillDocumentService.listSkills({ agentId: targetAgentId });

      return skills.slice(0, limit).map<NightlyReviewManagedSkillSummary>((skill) => ({
        description: skill.description,
        documentId: skill.bundle.agentDocumentId,
        name: skill.name,
        readonly: false,
      }));
    },
    listRelevantMemories: async ({ limit = 20 }) => {
      const rows = await reviewContextModel.listRelevantMemories({ limit });

      return rows.map<NightlyReviewRelevantMemorySummary>((row) => ({
        content: row.content,
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
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
        evidenceRefs: row.topicId ? [{ id: row.topicId, type: 'topic' }] : [],
        failedToolCount: row.failedToolCount,
        failureCount: row.failureCount,
        lastActivityAt: row.lastActivityAt.toISOString(),
        messageCount: row.messageCount,
        summary: row.summary,
        title: row.title ?? undefined,
        topicId: row.topicId ?? undefined,
      }));
    },
  });
  const executor = createServerMaintenanceExecutor({
    agentId,
    db,
    skillDocumentService,
    userId,
  });

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
    collectContext: (input) => collector.collectNightlyReviewContext(input),
    executePlan: (plan) => executor.execute(plan),
    planReviewOutput: (request) => planner.plan(request),
    runMaintenanceReviewAgent: (context) => runServerMaintenanceReviewAgent(db, userId, context),
    writeReceipts: (receipts) => persistAgentSignalReceipts(receipts),
  };
};
