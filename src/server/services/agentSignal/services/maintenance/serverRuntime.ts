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
import type { BriefItem } from '@/database/schemas';
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
import { runMaintenanceToolFirstRuntime } from './agent';
import { createMaintenanceAgentRunner } from './agentRunner';
import { createBriefMaintenanceService, createServerMaintenanceBriefWriter } from './brief';
import { projectMaintenanceToolRuntimeRun } from './briefProjection';
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
import type { MaintenanceProposalAction, MaintenanceProposalMetadata } from './proposal';
import {
  getMaintenanceProposalFromBriefMetadata,
  refreshMaintenanceProposal,
  supersedeMaintenanceProposal,
} from './proposal';
import { createMaintenanceProposalPreflightService } from './proposalPreflight';
import { createMaintenanceProposalSnapshotService } from './proposalSnapshot';
import { createSkillManagementService } from './skill';
import type {
  CloseMaintenanceProposalInput,
  CreateMaintenanceProposalInput,
  CreateSkillIfAbsentInput,
  MaintenanceToolOperationReservation,
  MaintenanceToolReceiptInput,
  MaintenanceToolWriteResult,
  RefreshMaintenanceProposalInput,
  ReplaceSkillContentCASInput,
  SupersedeMaintenanceProposalInput,
  WriteMemoryInput,
} from './tools';
import { createMaintenanceTools } from './tools';
import type {
  EvidenceRef,
  MaintenanceActionDraft,
  MaintenanceActionPolicyHints,
  MaintenanceActionTarget,
  MaintenancePlanDraft,
} from './types';
import { MaintenanceReviewScope, MaintenanceRisk } from './types';

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

const NIGHTLY_REVIEW_SOURCE_TYPE = 'agent.nightly_review.requested';
const MAINTENANCE_OPERATION_STATE_TTL_SECONDS = AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds;

const maintenanceOperationScopeKey = (idempotencyKey: string) =>
  `maintenance-operation:${idempotencyKey}`;

const maintenanceOperationReserveKey = (idempotencyKey: string) =>
  `maintenance-operation-reserve:${idempotencyKey}`;

const parseStoredOperationResult = (
  payload: Record<string, string> | undefined,
): MaintenanceToolWriteResult | undefined => {
  if (!payload?.result) return;

  try {
    const result = JSON.parse(payload.result) as MaintenanceToolWriteResult;

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

const createSkippedOperationResult = (): MaintenanceToolWriteResult => ({
  status: 'skipped_unsupported',
  summary:
    'Maintenance operation is already reserved or Redis is unavailable; skipped to avoid duplicate mutation.',
});

const reserveMaintenanceOperation = async (
  idempotencyKey: string,
): Promise<MaintenanceToolOperationReservation> => {
  const scopeKey = maintenanceOperationScopeKey(idempotencyKey);
  const existing = parseStoredOperationResult(await redisSourceEventStore.readWindow(scopeKey));

  if (existing) return { existing, reserved: false };

  // NOTICE:
  // Redis is the only available cross-worker idempotency boundary for nightly tool writes.
  // `tryDedupe` also returns false when the Redis client is unavailable, so the safe fallback is
  // to skip mutation instead of writing without a durable reservation.
  // Source/context: `src/server/services/agentSignal/store/adapters/redis/sourceEventStore.ts`.
  // Removal condition: replace with a database-backed maintenance operation ledger.
  const reserved = await redisSourceEventStore.tryDedupe(
    maintenanceOperationReserveKey(idempotencyKey),
    MAINTENANCE_OPERATION_STATE_TTL_SECONDS,
  );

  if (reserved) return { reserved: true };

  return {
    existing:
      parseStoredOperationResult(await redisSourceEventStore.readWindow(scopeKey)) ??
      createSkippedOperationResult(),
    reserved: false,
  };
};

const completeMaintenanceOperation = async (input: MaintenanceToolReceiptInput) => {
  await redisSourceEventStore.writeWindow(
    maintenanceOperationScopeKey(input.idempotencyKey),
    {
      result: JSON.stringify({
        ...(input.receiptId ? { receiptId: input.receiptId } : {}),
        ...(input.resourceId ? { resourceId: input.resourceId } : {}),
        status: input.status,
        ...(input.summary ? { summary: input.summary } : {}),
      } satisfies MaintenanceToolWriteResult),
    },
    MAINTENANCE_OPERATION_STATE_TTL_SECONDS,
  );
};

const getToolReceiptStatus = (
  status: MaintenanceToolReceiptInput['status'],
): 'applied' | 'failed' | 'proposed' | 'skipped' => {
  if (status === 'applied') return 'applied';
  if (status === 'failed') return 'failed';
  if (status === 'proposed') return 'proposed';

  return 'skipped';
};

const writeMaintenanceToolReceipt = async ({
  agentId,
  input,
  sourceId,
  userId,
}: {
  agentId: string;
  input: MaintenanceToolReceiptInput;
  sourceId: string;
  userId: string;
}) => {
  await persistAgentSignalReceipts([
    {
      agentId,
      createdAt: Date.now(),
      detail: input.summary ?? `Maintenance tool ${input.toolName} finished with ${input.status}.`,
      id: input.idempotencyKey,
      kind:
        input.toolName === 'createSkillIfAbsent' || input.toolName === 'replaceSkillContentCAS'
          ? 'skill'
          : 'maintenance',
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
      title: input.summary ?? 'Maintenance tool outcome',
      topicId: sourceId,
      userId,
    },
  ]);

  return { receiptId: input.idempotencyKey };
};

const createSkillProposalAction = (input: CreateSkillIfAbsentInput): MaintenanceProposalAction => ({
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
  risk: MaintenanceRisk.Low,
  target: { skillName: input.name },
});

const createRefineProposalAction = (
  input: ReplaceSkillContentCASInput,
): MaintenanceProposalAction => ({
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
  risk: MaintenanceRisk.Low,
  target: { skillDocumentId: input.skillDocumentId },
});

const getBriefMetadataWithProposal = (
  brief: BriefItem,
  proposal: MaintenanceProposalMetadata,
): BriefItem['metadata'] => {
  const metadata = getRecord(brief.metadata);
  const agentSignal = getRecord(metadata.agentSignal);
  const nightlySelfReview = getRecord(agentSignal.nightlySelfReview);

  return {
    ...metadata,
    agentSignal: {
      ...agentSignal,
      nightlySelfReview: {
        ...nightlySelfReview,
        maintenanceProposal: proposal,
      },
    },
  };
};

const getProposalToolCallPayload = (
  toolName: string,
  input:
    | CreateMaintenanceProposalInput
    | RefreshMaintenanceProposalInput
    | SupersedeMaintenanceProposalInput,
) => ({
  apiName: toolName,
  arguments: JSON.stringify(input),
  id: `${input.idempotencyKey}:tool-call`,
  identifier: 'agent-signal-maintenance',
  type: 'builtin' as const,
});

const collectPlanEvidenceRefs = (
  plan: ReturnType<typeof projectMaintenanceToolRuntimeRun>['projectionPlan'],
) => {
  const evidenceRefs = new Map<string, EvidenceRef>();

  for (const action of plan.actions) {
    for (const evidenceRef of action.evidenceRefs) {
      evidenceRefs.set(`${evidenceRef.type}:${evidenceRef.id}`, evidenceRef);
    }
  }

  return [...evidenceRefs.values()];
};

const getRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const getProposalActionSnapshotInput = (action: Record<string, unknown>) => {
  const operation = getRecord(action.operation);
  const operationInput = getRecord(operation.input);
  const target = getRecord(action.target);

  return {
    ...operationInput,
    name: getString(operationInput.name) ?? getString(target.skillName),
    skillDocumentId: getString(operationInput.skillDocumentId) ?? getString(target.skillDocumentId),
    title: getString(operationInput.title) ?? getString(target.skillName),
  };
};

const withCompleteProposalSnapshots = async ({
  agentId,
  input,
  snapshotService,
  userId,
}: {
  agentId: string;
  input: CreateMaintenanceProposalInput;
  snapshotService: ReturnType<typeof createMaintenanceProposalSnapshotService>;
  userId: string;
}): Promise<CreateMaintenanceProposalInput> => {
  if (!input.actions || input.actions.length === 0) {
    throw new Error('Maintenance proposal requires at least one action.');
  }

  const actions = await Promise.all(
    input.actions.map(async (rawAction) => {
      const action = getRecord(rawAction);
      const actionType = action.actionType;

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
  snapshotService: ReturnType<typeof createMaintenanceProposalSnapshotService>;
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
  input: CreateMaintenanceProposalInput;
  localDate: string;
  sourceId: string;
  toolName: 'createMaintenanceProposal';
  userId: string;
}) =>
  projectMaintenanceToolRuntimeRun({
    content: input.summary,
    localDate,
    outcomes: [
      {
        receiptId: input.idempotencyKey,
        status: 'proposed',
        summary: input.summary,
        toolName,
      },
    ],
    reviewScope: MaintenanceReviewScope.Nightly,
    sourceId,
    toolCalls: [getProposalToolCallPayload(toolName, input)],
    userId,
  });

const findMaintenanceProposalBrief = async ({
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
    limit: NIGHTLY_PROPOSAL_ACTIVITY_LIMIT,
    trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
  });

  return rows.find((row) => {
    if (proposalId && row.id === proposalId) return true;

    const proposal = getMaintenanceProposalFromBriefMetadata(row.metadata);

    return proposalKey ? proposal?.proposalKey === proposalKey : false;
  });
};

const updateMaintenanceProposalBrief = async ({
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
  updateProposal: (proposal: MaintenanceProposalMetadata) => MaintenanceProposalMetadata;
}) => {
  const brief = await findMaintenanceProposalBrief({
    agentId,
    briefModel,
    proposalId,
    proposalKey,
  });

  if (!brief) throw new Error('Maintenance proposal not found');

  const existingProposal = getMaintenanceProposalFromBriefMetadata(brief.metadata);
  if (!existingProposal) throw new Error('Maintenance proposal metadata not found');

  const updatedProposal = updateProposal(existingProposal);
  const updatedBrief = await briefModel.updateMetadata(
    brief.id,
    getBriefMetadataWithProposal(brief, updatedProposal),
  );

  return {
    resourceId: updatedBrief?.id ?? brief.id,
    summary: `Updated maintenance proposal ${updatedProposal.proposalKey}.`,
  };
};

const createServerMaintenanceToolset = ({
  agentId,
  briefModel,
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
  context: NightlyReviewContext;
  db: LobeChatDatabase;
  localDate: string;
  proposalBriefWriter: ReturnType<typeof createServerMaintenanceBriefWriter>;
  skillDocumentService: SkillManagementDocumentService;
  sourceId: string;
  userId: string;
}) => {
  const proposalPreflight = createMaintenanceProposalPreflightService({
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
  const proposalSnapshot = createMaintenanceProposalSnapshotService({
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

  return createMaintenanceTools({
    closeProposal: async (input: CloseMaintenanceProposalInput) =>
      updateMaintenanceProposalBrief({
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
    completeOperation: completeMaintenanceOperation,
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
        toolName: 'createMaintenanceProposal',
        userId,
      });
      const brief = createBriefMaintenanceService().projectNightlyReviewBrief({
        agentId,
        evidenceRefs: collectPlanEvidenceRefs(projection.projectionPlan),
        localDate,
        plan: projection.projectionPlan,
        result: projection.execution,
        reviewWindowEnd: context.reviewWindowEnd,
        reviewWindowStart: context.reviewWindowStart,
        timezone: 'UTC',
        userId,
      });

      if (!brief) throw new Error('Maintenance proposal projection produced no brief');

      const result = await proposalBriefWriter.writeDailyBrief(brief);

      return {
        proposalId: result?.id,
        resourceId: result?.id,
        summary: input.summary ?? 'Created maintenance proposal.',
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
      const memoryService = createMemoryMaintenanceService({
        writeMemory: async ({ content, evidenceRefs, idempotencyKey }) => {
          const result = await runMemoryActionAgent(
            {
              agentId,
              message: content,
              reason: `Agent Signal maintenance memory candidate from ${evidenceRefs.length} evidence refs.`,
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

      return {
        documentActivity: context.documentActivity,
        proposalActivity: context.proposalActivity,
        receiptActivity: context.receiptActivity,
        toolActivity: context.toolActivity,
        topics: includeAll
          ? context.topics
          : context.topics.filter((topic) =>
              topic.evidenceRefs.some((ref) => selectedEvidenceIds.has(ref.id)),
            ),
      };
    },
    getManagedSkill: ({ agentId: targetAgentId, skillDocumentId }) =>
      skillDocumentService.getSkill({
        agentDocumentId: skillDocumentId,
        agentId: targetAgentId,
        includeContent: true,
      }),
    listMaintenanceProposals: ({ agentId: targetAgentId }) =>
      listServerProposalActivity({
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
      const digest = await listServerProposalActivity({
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
    refreshProposal: async (input: RefreshMaintenanceProposalInput) =>
      updateMaintenanceProposalBrief({
        agentId,
        briefModel,
        proposalId: input.proposalId,
        proposalKey: input.proposalKey,
        updateProposal: (proposal) =>
          refreshMaintenanceProposal({
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
    reserveOperation: reserveMaintenanceOperation,
    supersedeProposal: async (input: SupersedeMaintenanceProposalInput) =>
      updateMaintenanceProposalBrief({
        agentId,
        briefModel,
        proposalId: input.proposalId,
        proposalKey: input.proposalKey,
        updateProposal: (proposal) =>
          supersedeMaintenanceProposal({
            existing: proposal,
            now: new Date().toISOString(),
            supersededBy: input.supersededBy,
          }),
      }),
    writeReceipt: (input) => writeMaintenanceToolReceipt({ agentId, input, sourceId, userId }),
  });
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
    runMaintenanceReviewAgent: async ({ context, localDate, sourceId, userId: runnerUserId }) => {
      const modelRuntime = await initModelRuntimeFromDB(
        db,
        runnerUserId,
        DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
      );
      const maintenanceTools = createServerMaintenanceToolset({
        agentId: context.agentId,
        briefModel,
        context,
        db,
        localDate: localDate ?? context.reviewWindowEnd.slice(0, 10),
        proposalBriefWriter: briefWriter,
        skillDocumentService,
        sourceId,
        userId: runnerUserId,
      });
      const maintenanceAgentRunner = createMaintenanceAgentRunner({
        maxSteps: 10,
        run: async ({ context, localDate, maxSteps, reviewScope, sourceId, tools, userId }) => {
          const runtimeResult = await runMaintenanceToolFirstRuntime({
            agentId: context.agentId,
            context,
            maxSteps,
            model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
            modelRuntime,
            sourceId,
            tools,
            userId,
          });
          const projected = projectMaintenanceToolRuntimeRun({
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
        tools: maintenanceTools,
      });

      return maintenanceAgentRunner.run({
        context,
        localDate,
        sourceId,
        userId: runnerUserId,
      });
    },
    writeDailyBrief: (brief) => briefWriter.writeDailyBrief(brief),
    writeReceipts: (receipts) => persistAgentSignalReceipts(receipts),
  };
};
