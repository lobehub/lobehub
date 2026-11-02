import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import type { QuickNoteProposalPayload } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { QuickNoteModel } from '@/database/models/quickNote';
import type { QuickNoteProposalItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { after } from '@/server/utils/scheduleAfterResponse';

import { resolveQuickNoteAgentId } from './agent';
import {
  QUICK_NOTE_PROPOSAL_EXECUTORS,
  QuickNoteApplyError,
  type QuickNoteExecutorResult,
  type QuickNoteProposalExecutorRegistry,
} from './executors';

/** Payload of the `quick_note.proposal.decided` source event. */
export interface QuickNoteProposalDecidedEvent {
  decision: 'accepted' | 'dismissed';
  edited: boolean;
  kind: string;
  preset?: string | null;
  proposalId: string;
  quickNoteId: string;
  reason?: string | null;
  resultId?: string | null;
  resultType?: string | null;
  runId: string;
  userId: string;
  via: 'auto' | 'user';
}

/**
 * Enqueues `quick_note.proposal.decided` so the reaction is recorded (receipt + procedure record)
 * without any Agent call. Delivery failure is logged; it never fails the user's decision.
 */
export const emitQuickNoteProposalDecided = async (
  event: QuickNoteProposalDecidedEvent,
  workspaceId?: string,
) => {
  try {
    await enqueueAgentSignalSourceEvent(
      {
        payload: event,
        scopeKey: `quick-note:${event.quickNoteId}`,
        sourceId: `${event.proposalId}:${event.decision}`,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.quickNoteProposalDecided,
      },
      { userId: event.userId, workspaceId },
    );
  } catch (error) {
    console.error('[QuickNote] failed to emit proposal decision %s:', event.proposalId, error);
  }
};

export interface QuickNoteProposalServiceDeps {
  emitDecided?: (event: QuickNoteProposalDecidedEvent) => Promise<void>;
  executors?: QuickNoteProposalExecutorRegistry;
  resolveQuickNoteAgentId?: (db: LobeChatDatabase) => Promise<string>;
}

/** Result of applying a Proposal. */
export interface QuickNoteApplyResult {
  /** `false` when the Proposal had already been applied; the stored result is returned. */
  applied: boolean;
  proposal: QuickNoteProposalItem;
}

/**
 * User and auto decisions on Quick Note Proposals.
 *
 * Call stack:
 *
 * quickNote router (`applyProposal` / `decideProposal` / `updateProposal`)
 * QuickNoteProcessingService.onRunComplete (auto-apply at score 4)
 *   -> {@link QuickNoteProposalService.apply}
 *     -> QuickNoteModel.lockPendingProposal (row lock, one transaction)
 *       -> executor.execute (domain service, no LLM)
 *         -> QuickNoteModel.markProposalApplied
 *     -> executor afterCommit (Task run / Goal advance kickoff), scheduled after the response
 *     -> `quick_note.proposal.decided` source event
 */
export class QuickNoteProposalService {
  private readonly db: LobeChatDatabase;
  private readonly deps: Required<QuickNoteProposalServiceDeps>;
  private readonly model: QuickNoteModel;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    deps: QuickNoteProposalServiceDeps = {},
  ) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.model = new QuickNoteModel(db, userId, workspaceId);
    this.deps = {
      emitDecided:
        deps.emitDecided ?? ((event) => emitQuickNoteProposalDecided(event, workspaceId)),
      executors: deps.executors ?? QUICK_NOTE_PROPOSAL_EXECUTORS,
      resolveQuickNoteAgentId:
        deps.resolveQuickNoteAgentId ??
        ((scopedDb) => resolveQuickNoteAgentId(scopedDb, userId, workspaceId)),
    };
  }

  /**
   * Applies a pending (current or stale) Proposal through its kind's executor.
   *
   * Use when:
   * - The user presses apply, or an Analyze Run reached the auto-apply threshold.
   *
   * Expects:
   * - The stored payload is valid for its kind; edits went through {@link updatePayload}.
   *
   * Returns:
   * - The accepted Proposal with `result_type` / `result_id`. Applying again returns the same
   *   result with `applied: false` instead of producing a second object.
   *
   * Throws:
   * - {@link QuickNoteApplyError} when the Proposal is missing, dismissed, or not executable.
   */
  apply = async (
    proposalId: string,
    options: { via?: 'auto' | 'user' } = {},
  ): Promise<QuickNoteApplyResult> => {
    let afterCommit: QuickNoteExecutorResult['afterCommit'];

    const outcome = await this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const model = new QuickNoteModel(tx, this.userId, this.workspaceId);
      const proposal = await model.lockPendingProposal(proposalId);

      if (!proposal) {
        // A concurrent or repeated apply already committed: return its result (idempotency).
        const existing = await model.findProposal(proposalId);
        if (existing?.decisionStatus === 'accepted' && existing.resultId) {
          return { applied: false, proposal: existing };
        }
        throw new QuickNoteApplyError(
          existing ? 'not_pending' : 'not_found',
          existing ? 'Proposal was already decided' : 'Proposal not found',
        );
      }

      const executor = this.deps.executors[proposal.kind];
      const payload = executor.schema.safeParse(proposal.payload);
      if (!payload.success) {
        throw new QuickNoteApplyError(
          'invalid_payload',
          `Proposal payload is not a valid ${proposal.kind}`,
          { cause: payload.error },
        );
      }

      const result = await (
        executor.execute as (...args: unknown[]) => Promise<QuickNoteExecutorResult>
      )(
        {
          db: tx,
          proposal,
          resolveQuickNoteAgentId: this.deps.resolveQuickNoteAgentId,
          rootDb: this.db,
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
        payload.data,
      );
      const applied = await model.markProposalApplied(
        proposalId,
        result.resultType,
        result.resultId,
      );
      if (!applied) throw new QuickNoteApplyError('not_pending', 'Proposal was already decided');

      afterCommit = result.afterCommit;
      return { applied: true, proposal: applied };
    });

    if (!outcome.applied) return outcome;

    if (afterCommit) {
      const kickoff = afterCommit;
      // The apply is durable once committed; starting the produced object (a Task run takes ~1s
      // to reserve and enqueue its first step) must not hold the user's response. `after()` keeps
      // the work alive past the response on serverless, and a failure never undoes the apply.
      after(async () => {
        try {
          await kickoff();
        } catch (error) {
          console.error('[QuickNote] post-apply kickoff failed for %s:', proposalId, error);
        }
      });
    }
    await this.deps.emitDecided(this.toEvent(outcome.proposal, options.via ?? 'user'));

    return outcome;
  };

  /**
   * Dismisses a pending Proposal with an optional reason.
   *
   * Returns:
   * - The dismissed Proposal with `decided_at`, or `undefined` when inaccessible or decided.
   */
  dismiss = async (proposalId: string, reason?: string | null) => {
    const proposal = await this.model.decideProposal(proposalId, 'dismissed', reason);
    if (proposal) await this.deps.emitDecided(this.toEvent(proposal, 'user'));
    return proposal;
  };

  /**
   * Overwrites a pending Proposal's payload after validating it for the Proposal's kind.
   *
   * Returns:
   * - The updated Proposal, or `undefined` when inaccessible or already decided.
   *
   * Throws:
   * - {@link QuickNoteApplyError} `invalid_payload` when the edit is not executable.
   */
  updatePayload = async (proposalId: string, payload: QuickNoteProposalPayload) => {
    const proposal = await this.model.findProposal(proposalId);
    if (!proposal) return undefined;

    const parsed = this.deps.executors[proposal.kind].schema.safeParse(payload);
    if (!parsed.success) {
      throw new QuickNoteApplyError(
        'invalid_payload',
        `Proposal payload is not a valid ${proposal.kind}`,
        { cause: parsed.error },
      );
    }

    return this.model.updateProposalPayload(proposalId, parsed.data as QuickNoteProposalPayload);
  };

  private toEvent = (
    proposal: QuickNoteProposalItem,
    via: 'auto' | 'user',
  ): QuickNoteProposalDecidedEvent => ({
    decision: proposal.decisionStatus === 'accepted' ? 'accepted' : 'dismissed',
    edited: !isEqual(proposal.payload, proposal.originalPayload),
    kind: proposal.kind,
    preset: proposal.preset,
    proposalId: proposal.id,
    quickNoteId: proposal.quickNoteId,
    reason: proposal.dismissReason,
    resultId: proposal.resultId,
    resultType: proposal.resultType,
    runId: proposal.runId,
    userId: this.userId,
    via,
  });
}
