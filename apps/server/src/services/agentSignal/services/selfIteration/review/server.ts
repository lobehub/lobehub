import type { AgentSignalRuntimeService } from '@lobechat/builtin-tool-agent-signal';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import { pickTrimmedString, toRecord } from '@lobechat/utils';
import pMap from 'p-map';

import { AgentSignalNightlyReviewModel } from '@/database/models/agentSignal/nightlyReview';
import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { BriefModel } from '@/database/models/brief';
import type { BriefItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AGENT_SIGNAL_DEFAULTS } from '@/server/services/agentSignal/constants';
import { isAgentSignalEnabledForUser } from '@/server/services/agentSignal/featureGate';
import { runMemoryActionAgent } from '@/server/services/agentSignal/policies/analyzeIntent/actions/userMemory';
import { redisSourceEventStore } from '@/server/services/agentSignal/store/adapters/redis/sourceEventStore';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { projectRun } from '../projection';
import type { CreateServerSelfIterationPolicyOptions } from '../server';
import { listServerSelfReviewProposalActivity } from '../server';
import type {
  CloseSelfReviewProposalInput,
  CreateSelfReviewProposalInput,
  CreateSkillIfAbsentInput,
  RefreshSelfReviewProposalInput,
  ReplaceSkillContentCASInput,
  SupersedeSelfReviewProposalInput,
  WriteMemoryInput,
} from '../tools/shared';
import { createMemoryService } from '../tools/shared';
import type { EvidenceRef } from '../types';
import { Risk, Scope } from '../types';
import type { createServerSelfReviewBriefWriter } from './brief';
import { createBriefSelfReviewService } from './brief';
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

interface ProposalBriefReader {
  listUnresolvedByAgentAndTrigger: (options: {
    agentId: string;
    limit?: number;
    trigger: string;
  }) => Promise<Awaited<ReturnType<BriefModel['listUnresolvedByAgentAndTrigger']>>>;
}

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

  const actions = await pMap(
    input.actions,
    async (rawAction) => {
      const action = toRecordOrEmpty(rawAction);
      const actionType = action.actionType;

      if (actionType === 'consolidate_skill') {
        const operation = toRecordOrEmpty(action.operation);
        const operationInput = toRecordOrEmpty(operation.input);
        const canonicalSkillDocumentId = pickTrimmedString(operationInput.canonicalSkillDocumentId);
        const sourceSkillIds = getStringArray(operationInput.sourceSkillIds);
        const sourceSnapshots = await pMap(
          sourceSkillIds,
          (skillDocumentId) =>
            snapshotService.captureActionSnapshot({
              actionType: 'refine_skill',
              agentId,
              input: { skillDocumentId },
              userId,
            }),
          { concurrency: 5 },
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
    },
    { concurrency: 5 },
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
  workspaceId?: string;
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
    workspaceId,
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
            { db, userId, workspaceId },
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
  workspaceId,
}: CreateServerSelfIterationPolicyOptions): CreateNightlyReviewSourceHandlerDependencies => {
  const nightlyReviewModel = new AgentSignalNightlyReviewModel(db);
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId, workspaceId);
  const briefModel = new BriefModel(db, userId, workspaceId);
  const skillDocumentService = new SkillManagementDocumentService(db, userId, workspaceId);
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
    db,
    workspaceId,
  };
};
