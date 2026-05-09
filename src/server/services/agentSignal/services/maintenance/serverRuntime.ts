import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import { createAgentSignalNightlyReviewMessages } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { z } from 'zod';

import { AgentSignalNightlyReviewModel } from '@/database/models/agentSignal/nightlyReview';
import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { BriefModel } from '@/database/models/brief';
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
import { createMaintenanceAgentRunner } from './agentRunner';
import { createServerMaintenanceBriefWriter } from './brief';
import { createMaintenanceExecutorService } from './executor';
import { createMemoryMaintenanceService } from './memory';
import type {
  FeedbackActivityDigest,
  NightlyReviewContext,
  NightlyReviewManagedSkillSummary,
  NightlyReviewRelevantMemorySummary,
  NightlyReviewTopicActivityRow,
  ProposalActivityDigest,
  ReceiptActivityDigest,
  ToolActivityDigest,
} from './nightlyCollector';
import { createNightlyReviewService } from './nightlyCollector';
import { mapNightlyDocumentActivityRows } from './nightlyDocumentActivity';
import { createMaintenancePlannerService } from './planner';
import { getMaintenanceProposalFromBriefMetadata } from './proposal';
import { createSkillManagementService } from './skill';
import { createMaintenanceTools } from './tools';
import type {
  EvidenceRef,
  MaintenanceActionDraft,
  MaintenanceActionPolicyHints,
  MaintenanceActionTarget,
  MaintenancePlanDraft,
} from './types';

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
                  summary: { type: ['string', 'null'] },
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
                required: ['id', 'summary', 'type'],
                type: 'object',
              },
              type: 'array',
            },
            policyHints: {
              additionalProperties: false,
              properties: {
                evidenceStrength: {
                  enum: ['weak', 'medium', 'strong', null],
                  type: ['string', 'null'],
                },
                mutationScope: { enum: ['small', 'broad', null], type: ['string', 'null'] },
                persistence: { enum: ['stable', 'temporal', null], type: ['string', 'null'] },
                sensitivity: { enum: ['normal', 'sensitive', null], type: ['string', 'null'] },
                userExplicitness: {
                  enum: ['explicit', 'implicit', 'inferred', null],
                  type: ['string', 'null'],
                },
              },
              required: [
                'evidenceStrength',
                'mutationScope',
                'persistence',
                'sensitivity',
                'userExplicitness',
              ],
              type: 'object',
            },
            rationale: { type: 'string' },
            target: {
              additionalProperties: false,
              properties: {
                memoryId: { type: ['string', 'null'] },
                skillDocumentId: { type: ['string', 'null'] },
                skillName: { type: ['string', 'null'] },
                targetReadonly: { type: ['boolean', 'null'] },
                taskIds: {
                  items: { type: 'string' },
                  type: ['array', 'null'],
                },
                topicIds: {
                  items: { type: 'string' },
                  type: ['array', 'null'],
                },
              },
              required: [
                'memoryId',
                'skillDocumentId',
                'skillName',
                'targetReadonly',
                'taskIds',
                'topicIds',
              ],
              type: 'object',
            },
            value: {
              additionalProperties: false,
              properties: {
                bodyMarkdown: { type: ['string', 'null'] },
                canonicalSkillDocumentId: { type: ['string', 'null'] },
                content: { type: ['string', 'null'] },
                description: { type: ['string', 'null'] },
                name: { type: ['string', 'null'] },
                patch: { type: ['string', 'null'] },
                readonly: { type: ['boolean', 'null'] },
                skillDocumentId: { type: ['string', 'null'] },
                sourceSkillIds: {
                  items: { type: 'string' },
                  type: ['array', 'null'],
                },
                targetReadonly: { type: ['boolean', 'null'] },
                title: { type: ['string', 'null'] },
              },
              required: [
                'bodyMarkdown',
                'canonicalSkillDocumentId',
                'content',
                'description',
                'name',
                'patch',
                'readonly',
                'skillDocumentId',
                'sourceSkillIds',
                'targetReadonly',
                'title',
              ],
              type: ['object', 'null'],
            },
          },
          required: [
            'actionType',
            'confidence',
            'evidenceRefs',
            'policyHints',
            'rationale',
            'target',
            'value',
          ],
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
                  summary: { type: ['string', 'null'] },
                  type: { type: 'string' },
                },
                required: ['id', 'summary', 'type'],
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

/** Bounded unresolved Daily Brief read budget for proposal activity digesting. */
const NIGHTLY_PROPOSAL_ACTIVITY_LIMIT = 20;

/** Daily Brief trigger used by Agent Signal nightly maintenance proposals. */
const NIGHTLY_REVIEW_BRIEF_TRIGGER = 'agent-signal:nightly-review';

const ACTIVE_PROPOSAL_STATUSES = new Set(['accepted', 'applying', 'pending']);

interface ProposalBriefReader {
  listUnresolvedByAgentAndTrigger: (options: {
    agentId: string;
    limit?: number;
    trigger: string;
  }) => Promise<Awaited<ReturnType<BriefModel['listUnresolvedByAgentAndTrigger']>>>;
}

// Runtime parser for model output after structured generation. This mirrors the
// model-facing schema above, but the two schemas serve different boundaries.
const EvidenceRefSchema = z
  .object({
    id: z.string(),
    summary: z.string().nullish(),
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
  })
  .transform(
    (value): EvidenceRef => ({
      id: value.id,
      ...(value.summary ? { summary: value.summary } : {}),
      type: value.type,
    }),
  );

const MaintenanceActionDraftSchema: z.ZodType<MaintenanceActionDraft, z.ZodTypeDef, unknown> =
  z.object({
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
        evidenceStrength: z.enum(['weak', 'medium', 'strong']).nullish(),
        mutationScope: z.enum(['small', 'broad']).nullish(),
        persistence: z.enum(['stable', 'temporal']).nullish(),
        sensitivity: z.enum(['normal', 'sensitive']).nullish(),
        userExplicitness: z.enum(['explicit', 'implicit', 'inferred']).nullish(),
      })
      .nullable()
      .transform((value): MaintenanceActionPolicyHints | undefined =>
        value
          ? {
              ...(value.evidenceStrength ? { evidenceStrength: value.evidenceStrength } : {}),
              ...(value.mutationScope ? { mutationScope: value.mutationScope } : {}),
              ...(value.persistence ? { persistence: value.persistence } : {}),
              ...(value.sensitivity ? { sensitivity: value.sensitivity } : {}),
              ...(value.userExplicitness ? { userExplicitness: value.userExplicitness } : {}),
            }
          : undefined,
      )
      .optional(),
    rationale: z.string(),
    target: z
      .object({
        memoryId: z.string().nullish(),
        skillDocumentId: z.string().nullish(),
        skillName: z.string().nullish(),
        targetReadonly: z.boolean().nullish(),
        taskIds: z.array(z.string()).nullish(),
        topicIds: z.array(z.string()).nullish(),
      })
      .nullable()
      .transform((value): MaintenanceActionTarget | undefined =>
        value
          ? {
              ...(value.memoryId ? { memoryId: value.memoryId } : {}),
              ...(value.skillDocumentId ? { skillDocumentId: value.skillDocumentId } : {}),
              ...(value.skillName ? { skillName: value.skillName } : {}),
              ...(typeof value.targetReadonly === 'boolean'
                ? { targetReadonly: value.targetReadonly }
                : {}),
              ...(value.taskIds ? { taskIds: value.taskIds } : {}),
              ...(value.topicIds ? { topicIds: value.topicIds } : {}),
            }
          : undefined,
      )
      .optional(),
    value: z.unknown().optional(),
  });

const MaintenancePlanDraftSchema: z.ZodType<MaintenancePlanDraft, z.ZodTypeDef, unknown> = z.object(
  {
    actions: z.array(MaintenanceActionDraftSchema),
    findings: z.array(
      z.object({
        evidenceRefs: z.array(EvidenceRefSchema),
        severity: z.enum(['high', 'low', 'medium']),
        summary: z.string(),
      }),
    ),
    summary: z.string(),
  },
);

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
        const bodyMarkdown = getStringField(skillInput, 'bodyMarkdown') ?? '';
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
  return tracer.startActiveSpan(
    'agent_signal.maintenance_review_agent.run',
    {
      attributes: {
        'agent.signal.agent_id': context.agentId,
        'agent.signal.model': DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
        'agent.signal.provider': DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
        'agent.signal.user_id': userId,
      },
    },
    async (span) => {
      try {
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
        const draft = MaintenancePlanDraftSchema.parse(result);

        span.setAttribute('agent.signal.nightly.draft_action_count', draft.actions.length);
        span.setAttribute('agent.signal.nightly.finding_count', draft.findings.length);
        span.setStatus({ code: SpanStatusCode.OK });

        return draft;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message:
            error instanceof Error ? error.message : 'AgentSignal maintenance reviewer failed',
        });
        span.recordException(error as Error);

        throw error;
      } finally {
        span.end();
      }
    },
  );
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

const getProposalTargetDigest = (
  proposal: NonNullable<ReturnType<typeof getMaintenanceProposalFromBriefMetadata>>,
): Pick<ProposalActivityDigest['active'][number], 'targetId' | 'targetTitle'> => {
  const action = proposal.actions[0];
  const target = action?.target;

  return {
    ...(target?.skillDocumentId
      ? { targetId: target.skillDocumentId }
      : target?.memoryId
        ? { targetId: target.memoryId }
        : target?.skillName
          ? { targetId: target.skillName }
          : {}),
    ...(action?.baseSnapshot?.targetTitle ? { targetTitle: action.baseSnapshot.targetTitle } : {}),
  };
};

const getProposalEvidenceCount = (
  proposal: NonNullable<ReturnType<typeof getMaintenanceProposalFromBriefMetadata>>,
) => {
  const evidenceRefs = new Map<string, EvidenceRef>();

  for (const evidenceRef of proposal.evidenceRefs ?? []) {
    evidenceRefs.set(`${evidenceRef.type}:${evidenceRef.id}`, evidenceRef);
  }

  for (const action of proposal.actions) {
    for (const evidenceRef of action.evidenceRefs) {
      evidenceRefs.set(`${evidenceRef.type}:${evidenceRef.id}`, evidenceRef);
    }
  }

  return evidenceRefs.size;
};

const hasPendingProposalExpired = ({ expiresAt, now }: { expiresAt: string; now: string }) => {
  const expiresAtMs = new Date(expiresAt).getTime();
  const nowMs = new Date(now).getTime();

  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs;
};

const isNoopProposal = (
  proposal: NonNullable<ReturnType<typeof getMaintenanceProposalFromBriefMetadata>>,
) =>
  proposal.actionType === 'noop' ||
  proposal.actions.every((action) => action.actionType === 'noop');

/**
 * Lists existing server-side maintenance proposal activity for one agent.
 *
 * Use when:
 * - Nightly review context needs unresolved proposal state
 * - Tests need the server adapter behavior without booting the full runtime
 *
 * Expects:
 * - `briefModel` applies user, agent, trigger, and unresolved filters before the limit
 * - `now` is an ISO timestamp used to treat expired pending proposals as inactive
 * - Stored metadata may be malformed and must be treated as absent
 *
 * Returns:
 * - Active unresolved proposal digests plus unresolved status counts
 */
export const listServerProposalActivity = async ({
  agentId,
  briefModel,
  now = new Date().toISOString(),
  userId,
}: {
  agentId: string;
  briefModel: ProposalBriefReader;
  now?: string;
  userId: string;
}): Promise<ProposalActivityDigest> =>
  tracer.startActiveSpan(
    'agent_signal.nightly_review.collector.list_proposal_activity',
    {
      attributes: {
        'agent.signal.agent_id': agentId,
        'agent.signal.nightly.proposal_read_limit': NIGHTLY_PROPOSAL_ACTIVITY_LIMIT,
        'agent.signal.user_id': userId,
      },
    },
    async (span) => {
      try {
        const rows = await briefModel.listUnresolvedByAgentAndTrigger({
          agentId,
          limit: NIGHTLY_PROPOSAL_ACTIVITY_LIMIT,
          trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
        });
        const digest: ProposalActivityDigest = {
          active: [],
          dismissedCount: 0,
          expiredCount: 0,
          staleCount: 0,
          supersededCount: 0,
        };
        let validProposalCount = 0;

        for (const brief of rows) {
          if (brief.agentId !== agentId) continue;
          if (brief.trigger !== NIGHTLY_REVIEW_BRIEF_TRIGGER) continue;

          const proposal = getMaintenanceProposalFromBriefMetadata(brief.metadata);
          if (!proposal) continue;
          if (isNoopProposal(proposal)) continue;

          validProposalCount += 1;

          if (proposal.status === 'dismissed') digest.dismissedCount += 1;
          if (proposal.status === 'expired') digest.expiredCount += 1;
          if (proposal.status === 'stale') digest.staleCount += 1;
          if (proposal.status === 'superseded') digest.supersededCount += 1;

          if (
            proposal.status === 'pending' &&
            hasPendingProposalExpired({ expiresAt: proposal.expiresAt, now })
          ) {
            digest.expiredCount += 1;
            continue;
          }

          if (!ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) continue;

          digest.active.push({
            actionType: proposal.actionType,
            createdAt: proposal.createdAt,
            evidenceCount: getProposalEvidenceCount(proposal),
            expiresAt: proposal.expiresAt,
            proposalId: brief.id,
            proposalKey: proposal.proposalKey,
            status: proposal.status,
            summary: brief.summary,
            ...getProposalTargetDigest(proposal),
            updatedAt: proposal.updatedAt,
          });
        }

        span.setAttribute('agent.signal.nightly.proposal_unresolved_row_count', rows.length);
        span.setAttribute('agent.signal.nightly.proposal_valid_count', validProposalCount);
        span.setAttribute('agent.signal.nightly.proposal_active_count', digest.active.length);
        span.setAttribute('agent.signal.nightly.proposal_dismissed_count', digest.dismissedCount);
        span.setAttribute('agent.signal.nightly.proposal_expired_count', digest.expiredCount);
        span.setAttribute('agent.signal.nightly.proposal_stale_count', digest.staleCount);
        span.setAttribute('agent.signal.nightly.proposal_superseded_count', digest.supersededCount);
        span.setStatus({ code: SpanStatusCode.OK });

        return digest;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message:
            error instanceof Error
              ? error.message
              : 'AgentSignal nightly proposal activity read failed',
        });
        span.recordException(error as Error);

        throw error;
      } finally {
        span.end();
      }
    },
  );

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
  const briefModel = new BriefModel(db, userId);
  const skillDocumentService = new SkillManagementDocumentService(db, userId);
  const collector = createNightlyReviewService({
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
      listServerProposalActivity({
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
  const executor = createServerMaintenanceExecutor({
    agentId,
    db,
    skillDocumentService,
    userId,
  });
  const maintenanceTools = createMaintenanceTools({
    reserveOperation: async () => ({ reserved: true }),
    writeReceipt: async () => ({}),
  });
  const maintenanceAgentRunner = createMaintenanceAgentRunner({
    maxSteps: 10,
    run: async ({ context, localDate, reviewScope, sourceId }) => {
      const draft = await runServerMaintenanceReviewAgent(db, userId, context);
      const projectionPlan = planner.plan({
        draft,
        localDate,
        reviewScope,
        sourceId,
        userId,
      });
      const execution = await executor.execute(projectionPlan);

      return {
        execution,
        projectionPlan,
        stepCount: 1,
      };
    },
    tools: maintenanceTools,
  });
  const briefWriter = createServerMaintenanceBriefWriter(db, userId);

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
    runMaintenanceReviewAgent: ({ context, localDate, sourceId, userId: runnerUserId }) =>
      maintenanceAgentRunner.run({
        context,
        localDate,
        sourceId,
        userId: runnerUserId,
      }),
    writeDailyBrief: (brief) => briefWriter.writeDailyBrief(brief),
    writeReceipts: (receipts) => persistAgentSignalReceipts(receipts),
  };
};
