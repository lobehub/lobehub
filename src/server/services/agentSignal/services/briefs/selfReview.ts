import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { BriefModel } from '@/database/models/brief';
import type { BriefItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AGENT_SIGNAL_DEFAULTS } from '@/server/services/agentSignal/constants';
import { isAgentSignalEnabledForUser } from '@/server/services/agentSignal/featureGate';
import {
  createBriefMaintenanceService,
  getNightlySelfReviewBriefMetadata,
  NIGHTLY_REVIEW_BRIEF_TRIGGER,
} from '@/server/services/agentSignal/services/maintenance/brief';
import type { MaintenanceProposalMetadata } from '@/server/services/agentSignal/services/maintenance/proposal';
import { getMaintenanceProposalFromBriefMetadata } from '@/server/services/agentSignal/services/maintenance/proposal';
import { createMaintenanceProposalApplyService } from '@/server/services/agentSignal/services/maintenance/proposalApply';
import { createMaintenanceProposalPreflightService } from '@/server/services/agentSignal/services/maintenance/proposalPreflight';
import {
  createMaintenanceTools,
  type MaintenanceToolOperationReservation,
  type MaintenanceToolReceiptInput,
  type MaintenanceToolWriteResult,
} from '@/server/services/agentSignal/services/maintenance/tools';
import { MaintenanceRisk } from '@/server/services/agentSignal/services/maintenance/types';
import { persistAgentSignalReceipts } from '@/server/services/agentSignal/services/receiptService';
import { redisSourceEventStore } from '@/server/services/agentSignal/store/adapters/redis/sourceEventStore';
import type { BriefResolveOptions } from '@/server/services/brief';
import { BriefService } from '@/server/services/brief';
import { SkillManagementDocumentService } from '@/server/services/skillManagement/SkillManagementDocumentService';

export interface MaintenanceProposalBriefResolutionInput {
  /** User action requested by the Daily Brief card. */
  action: 'approve' | 'dismiss';
  /** Brief row that stores the pending proposal metadata. */
  brief: BriefItem;
  /** Frozen proposal metadata extracted from the brief. */
  proposal: MaintenanceProposalMetadata;
}

export interface MaintenanceProposalBriefResolutionResult {
  /** Latest brief row after proposal metadata updates. */
  brief: BriefItem | null;
  /** Resolution action to store when it differs from the requested action. */
  resolveAction?: string;
  /** Resolve the brief after proposal handling succeeds. */
  shouldResolve: boolean;
}

export interface AgentSignalSelfReviewBriefServiceOptions {
  /** Optional override used by tests or alternate runtimes for Agent Signal proposal approval. */
  maintenanceProposalResolver?: (
    input: MaintenanceProposalBriefResolutionInput,
  ) => Promise<MaintenanceProposalBriefResolutionResult>;
}

const asMetadataRecord = (metadata: unknown): Record<string, unknown> =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

const MAINTENANCE_OPERATION_STATE_TTL_SECONDS = AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds;
const MAINTENANCE_PROPOSAL_APPROVED_SOURCE_TYPE = 'agent.maintenance_proposal.approved';

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

const getToolReceiptStatus = (
  status: MaintenanceToolReceiptInput['status'],
): 'applied' | 'failed' | 'proposed' | 'skipped' => {
  if (status === 'applied') return 'applied';
  if (status === 'failed') return 'failed';
  if (status === 'proposed') return 'proposed';

  return 'skipped';
};

/**
 * Resolves Agent Signal self-review Daily Brief actions.
 *
 * Use when:
 * - API boundaries resolve Daily Briefs that may contain Agent Signal maintenance proposals
 * - Approve/dismiss must run self-review proposal preflight before normal brief resolution
 *
 * Expects:
 * - `db` and `userId` belong to the current authenticated request
 * - The API boundary has already dispatched by `brief.trigger`
 *
 * Returns:
 * - The updated brief row, or `null` when the brief does not exist
 *
 * Call stack:
 *
 * briefRouter.resolve
 *   -> {@link AgentSignalSelfReviewBriefService.resolve}
 *     -> {@link AgentSignalSelfReviewBriefService.resolveMaintenanceProposalIfPending}
 *       -> {@link BriefService.resolve}
 */
export class AgentSignalSelfReviewBriefService {
  private briefService: BriefService;
  private briefModel: BriefModel;
  private db: LobeChatDatabase;
  private maintenanceProposalResolver?: AgentSignalSelfReviewBriefServiceOptions['maintenanceProposalResolver'];
  private userId: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options: AgentSignalSelfReviewBriefServiceOptions = {},
  ) {
    this.db = db;
    this.userId = userId;
    this.briefService = new BriefService(db, userId);
    this.briefModel = new BriefModel(db, userId);
    this.maintenanceProposalResolver = options.maintenanceProposalResolver;
  }

  /**
   * Resolves a self-review brief with proposal handling when applicable.
   *
   * Use when:
   * - A trigger dispatch boundary selected `agent-signal:nightly-review`
   * - A user clicked approve, dismiss, or another generic brief action
   *
   * Expects:
   * - `brief` was already loaded by the trigger dispatch boundary
   * - `options.action` may be any generic brief action
   *
   * Returns:
   * - The resolved or still-pending brief row
   */
  async resolve(brief: BriefItem, options?: BriefResolveOptions): Promise<BriefItem | null> {
    const proposalResult = await this.resolveMaintenanceProposalIfPending(brief, options?.action);

    if (proposalResult) {
      if (!proposalResult.shouldResolve) return proposalResult.brief;

      return this.briefService.resolve(brief.id, {
        ...options,
        action: proposalResult.resolveAction ?? options?.action,
      });
    }

    return this.briefService.resolve(brief.id, options);
  }

  private async resolveMaintenanceProposalIfPending(
    brief: BriefItem,
    action?: string,
  ): Promise<MaintenanceProposalBriefResolutionResult | undefined> {
    if (brief.trigger !== NIGHTLY_REVIEW_BRIEF_TRIGGER) return;
    const proposal = getMaintenanceProposalFromBriefMetadata(brief.metadata);
    if (!proposal || proposal.status !== 'pending') return;
    if (action !== 'approve' && action !== 'dismiss') return;
    const proposalAction: MaintenanceProposalBriefResolutionInput['action'] = action;

    const input = { action: proposalAction, brief, proposal };
    if (this.maintenanceProposalResolver) return this.maintenanceProposalResolver(input);

    return this.resolveMaintenanceProposal(input);
  }

  private async resolveMaintenanceProposal({
    action,
    brief,
    proposal,
  }: MaintenanceProposalBriefResolutionInput): Promise<MaintenanceProposalBriefResolutionResult> {
    if (action === 'dismiss') {
      const updatedBrief = await this.updateProposal(brief, {
        ...proposal,
        status: 'dismissed',
        updatedAt: new Date().toISOString(),
      });

      return { brief: updatedBrief, shouldResolve: true };
    }

    if (!brief.agentId) return { brief, shouldResolve: false };

    const metadata = getNightlySelfReviewBriefMetadata(brief.metadata);
    const sourceId =
      typeof metadata?.sourceId === 'string'
        ? metadata.sourceId
        : `maintenance-proposal-approve:${brief.id}`;
    const skillDocumentService = new SkillManagementDocumentService(this.db, this.userId);
    const preflight = createMaintenanceProposalPreflightService({
      isSkillNameAvailable: async ({ name }) => {
        const skill = await skillDocumentService.getSkill({
          agentId: brief.agentId ?? '',
          name,
        });

        return !skill;
      },
      readSkillTargetSnapshot: (agentDocumentId) =>
        skillDocumentService.readSkillTargetSnapshot({
          agentDocumentId,
          agentId: brief.agentId ?? '',
        }),
    });
    const tools = createMaintenanceTools({
      createSkill: async (toolInput) => {
        const result = await skillDocumentService.createSkill({
          agentId: brief.agentId ?? '',
          bodyMarkdown: toolInput.bodyMarkdown,
          description: toolInput.description ?? '',
          name: toolInput.name,
          title: toolInput.title ?? toolInput.name,
        });

        return {
          resourceId: result.bundle.agentDocumentId,
          summary: `Created managed skill ${result.name}.`,
        };
      },
      preflight: async (toolInput) => {
        if (!('baseSnapshot' in toolInput) || !('skillDocumentId' in toolInput)) {
          return { allowed: false, reason: 'Unsupported maintenance preflight target.' };
        }

        const result = await preflight.checkAction({
          actionType: 'refine_skill',
          baseSnapshot: toolInput.baseSnapshot,
          evidenceRefs: [],
          idempotencyKey: toolInput.idempotencyKey,
          operation: {
            domain: 'skill',
            input: {
              bodyMarkdown: toolInput.bodyMarkdown,
              skillDocumentId: toolInput.skillDocumentId,
              userId: toolInput.userId,
            },
            operation: 'refine',
          },
          rationale: toolInput.summary ?? 'Apply approved maintenance proposal.',
          risk: MaintenanceRisk.Medium,
          target: { skillDocumentId: toolInput.skillDocumentId },
        });

        return result.allowed ? { allowed: true } : { allowed: false, reason: result.reason };
      },
      replaceSkill: async (toolInput) => {
        const result = await skillDocumentService.replaceSkillIndex({
          agentId: brief.agentId ?? '',
          agentDocumentId: toolInput.skillDocumentId,
          bodyMarkdown: toolInput.bodyMarkdown,
          description: toolInput.description,
        });

        if (!result) throw new Error('Skill target not found');

        return {
          resourceId: result.bundle.agentDocumentId,
          summary: `Refined managed skill ${result.name}.`,
        };
      },
      reserveOperation: async (
        idempotencyKey: string,
      ): Promise<MaintenanceToolOperationReservation> => {
        const scopeKey = maintenanceOperationScopeKey(idempotencyKey);
        const existing = parseStoredOperationResult(
          await redisSourceEventStore.readWindow(scopeKey),
        );

        if (existing) return { existing, reserved: false };

        // NOTICE:
        // Redis is the only cross-request idempotency boundary available for Daily Brief
        // proposal approvals. If reservation fails or Redis is unavailable, skip mutation instead
        // of applying without a durable operation record.
        // Root cause summary: approve is a user-triggered HTTP path and can be clicked twice or
        // race across workers.
        // Source/context: mirrors `reserveMaintenanceOperation` in
        // `src/server/services/agentSignal/services/maintenance/serverRuntime.ts`.
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
      },
      writeReceipt: async (toolInput) => {
        await persistAgentSignalReceipts([
          {
            agentId: brief.agentId ?? '',
            createdAt: Date.now(),
            detail:
              toolInput.summary ??
              `Maintenance tool ${toolInput.toolName} finished with ${toolInput.status}.`,
            id: toolInput.idempotencyKey,
            kind:
              toolInput.toolName === 'createSkillIfAbsent' ||
              toolInput.toolName === 'replaceSkillContentCAS'
                ? 'skill'
                : 'maintenance',
            metadata: {
              sourceType: MAINTENANCE_PROPOSAL_APPROVED_SOURCE_TYPE,
            },
            sourceId,
            sourceType: MAINTENANCE_PROPOSAL_APPROVED_SOURCE_TYPE,
            status: getToolReceiptStatus(toolInput.status),
            ...(toolInput.resourceId &&
            (toolInput.toolName === 'createSkillIfAbsent' ||
              toolInput.toolName === 'replaceSkillContentCAS')
              ? {
                  target: {
                    id: toolInput.resourceId,
                    ...(toolInput.summary ? { summary: toolInput.summary } : {}),
                    title: toolInput.summary ?? toolInput.resourceId,
                    type: 'skill',
                  },
                }
              : {}),
            title: toolInput.summary ?? 'Maintenance tool outcome',
            topicId: sourceId,
            userId: this.userId,
          },
        ]);

        return { receiptId: toolInput.idempotencyKey };
      },
      completeOperation: async (toolInput) => {
        await redisSourceEventStore.writeWindow(
          maintenanceOperationScopeKey(toolInput.idempotencyKey),
          {
            result: JSON.stringify({
              ...(toolInput.receiptId ? { receiptId: toolInput.receiptId } : {}),
              ...(toolInput.resourceId ? { resourceId: toolInput.resourceId } : {}),
              status: toolInput.status,
              ...(toolInput.summary ? { summary: toolInput.summary } : {}),
            } satisfies MaintenanceToolWriteResult),
          },
          MAINTENANCE_OPERATION_STATE_TTL_SECONDS,
        );
      },
    });
    const briefMaintenance = createBriefMaintenanceService();
    const applyService = createMaintenanceProposalApplyService({
      checkAction: preflight.checkAction,
      checkGates: () =>
        briefMaintenance.canApplyMaintenanceProposal({
          checkAgentGate: () =>
            new AgentSignalReviewContextModel(this.db, this.userId).canAgentRunSelfIteration(
              brief.agentId ?? '',
            ),
          checkServerGate: () => true,
          checkUserGate: () => isAgentSignalEnabledForUser(this.db, this.userId),
        }),
      tools,
      updateProposal: async (nextProposal) => {
        await this.updateProposal(brief, nextProposal);
      },
    });
    const result = await applyService.apply({
      agentId: brief.agentId,
      proposal,
      sourceId,
      sourceType: MAINTENANCE_PROPOSAL_APPROVED_SOURCE_TYPE,
      userId: this.userId,
      ...(typeof metadata?.localDate === 'string' ? { localDate: metadata.localDate } : {}),
      ...(typeof metadata?.timezone === 'string' ? { timezone: metadata.timezone } : {}),
    });
    const updatedBrief = await this.briefModel.findById(brief.id);

    if (result.proposal.status === 'applied') {
      return { brief: updatedBrief, shouldResolve: true };
    }

    if (result.proposal.status === 'partially_failed') {
      return { brief: updatedBrief, resolveAction: 'approve_partial', shouldResolve: true };
    }

    return { brief: updatedBrief, shouldResolve: false };
  }

  private updateProposal(brief: BriefItem, nextProposal: MaintenanceProposalMetadata) {
    const metadata = asMetadataRecord(brief.metadata);
    const agentSignal = asMetadataRecord(metadata.agentSignal);
    const nightlySelfReview = asMetadataRecord(agentSignal.nightlySelfReview);

    return this.briefModel.updateMetadata(brief.id, {
      ...metadata,
      agentSignal: {
        ...agentSignal,
        nightlySelfReview: {
          ...nightlySelfReview,
          maintenanceProposal: nextProposal,
        },
      },
    });
  }
}
