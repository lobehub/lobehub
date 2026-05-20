import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import type { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import type { BriefModel } from '@/database/models/brief';
import type { LobeChatDatabase } from '@/database/type';

import { NIGHTLY_REVIEW_BRIEF_TRIGGER } from './review/brief';
import type { ProposalActivityDigest } from './review/collect';
import { getSelfReviewProposalFromBriefMetadata } from './review/proposal';
import type { EvidenceRef } from './types';

/** Bounded unresolved Daily Brief read budget for proposal activity digesting. */
const NIGHTLY_PROPOSAL_ACTIVITY_LIMIT = 20;

const ACTIVE_PROPOSAL_STATUSES = new Set(['accepted', 'applying', 'pending']);

interface ProposalBriefReader {
  listUnresolvedByAgentAndTrigger: (options: {
    agentId: string;
    limit?: number;
    trigger: string;
  }) => Promise<Awaited<ReturnType<BriefModel['listUnresolvedByAgentAndTrigger']>>>;
}

/**
 * Options for composing server self-iteration policy handlers.
 */
export interface CreateServerSelfIterationPolicyOptions {
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

/**
 * Checks whether a server self-iteration source may run for the current workflow scope.
 *
 * Use when:
 * - Review, reflection, and intent server adapters need the same feature and ownership gate
 * - Workflow payload `agentId` must constrain source-owned agent ids
 *
 * Expects:
 * - `selfIterationEnabled` was computed for the same user before policy execution
 * - `reviewContextModel` is scoped to the current user
 *
 * Returns:
 * - `true` only when feature gate, workflow agent scope, and agent-level DB gate all pass
 */
export const canRunSelfIterationSource = async (input: {
  agentId: string;
  expectedAgentId?: string;
  reviewContextModel: AgentSignalReviewContextModel;
  selfIterationEnabled: boolean;
}) => {
  if (!input.selfIterationEnabled) return false;
  if (input.expectedAgentId && input.agentId !== input.expectedAgentId) return false;

  return input.reviewContextModel.canAgentRunSelfIteration(input.agentId);
};

const getProposalTargetDigest = (
  proposal: NonNullable<ReturnType<typeof getSelfReviewProposalFromBriefMetadata>>,
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
  proposal: NonNullable<ReturnType<typeof getSelfReviewProposalFromBriefMetadata>>,
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
  proposal: NonNullable<ReturnType<typeof getSelfReviewProposalFromBriefMetadata>>,
) =>
  proposal.actionType === 'noop' ||
  proposal.actions.every((action) => action.actionType === 'noop');

/**
 * Lists existing server-side self-review proposal activity for one agent.
 *
 * Use when:
 * - Nightly self-review context needs unresolved proposal state
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
export const listServerSelfReviewProposalActivity = async ({
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

          const proposal = getSelfReviewProposalFromBriefMetadata(brief.metadata);
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
