import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import debug from 'debug';

import type { CompletionCallbackParams } from '../../../policies/completionPolicy';
import { type AgentSignalReceiptStore, persistAgentSignalReceipts } from '../../receiptService';
import type { SelfReviewBriefProjection } from '../review/brief';
import { createBriefSelfReviewService } from '../review/brief';
import type { SelfReviewBriefTextTranslator } from '../review/briefText';
import type { SelfReviewIdea } from '../review/proposal';
import type { Idea } from '../types';
import { ReviewRunStatus, Risk } from '../types';
import {
  buildSelfIterationReceipts,
  getIdeas,
  isSkippedStatus,
} from './buildSelfIterationReceipts';
import type { SelfIterationCompletionPayload } from './extractCompletionPayload';

const log = debug('lobe-server:completion-lifecycle');

/** Daily Brief deps for nightly reviews that only recorded ideas. */
export interface SelfIterationIdeasBriefOptions {
  /** Resolves the brief owner's `home` translator; omitted → English resources. */
  resolveTranslator?: () => Promise<SelfReviewBriefTextTranslator | undefined>;
  /** Writer that persists (and dedupes) nightly self-review Daily Briefs. */
  writer: { writeDailyBrief: (brief: SelfReviewBriefProjection) => Promise<unknown> };
}

export interface SelfIterationCompletionHandlerOptions {
  /** Writes an `ideas` Daily Brief for idea-only nightly reviews. Omitted → no brief. */
  ideasBrief?: SelfIterationIdeasBriefOptions;
  /** Receipt store override (defaults to the Redis store). Injected in tests. */
  receiptStore?: AgentSignalReceiptStore;
}

const RISKS = new Set<string>(Object.values(Risk));

const toSelfReviewIdea = (idea: Idea): SelfReviewIdea => ({
  evidenceRefs: Array.isArray(idea.evidenceRefs) ? idea.evidenceRefs : [],
  idempotencyKey: idea.idempotencyKey,
  rationale: idea.rationale,
  risk: RISKS.has(idea.risk) ? (idea.risk as Risk) : Risk.Low,
  ...(idea.target
    ? {
        target: {
          ...(idea.target.memoryId ? { memoryId: idea.target.memoryId } : {}),
          ...(idea.target.skillDocumentId ? { skillDocumentId: idea.target.skillDocumentId } : {}),
          ...(idea.target.skillName ? { skillName: idea.target.skillName } : {}),
          ...(idea.target.taskIds ? { taskIds: idea.target.taskIds } : {}),
          ...(idea.target.topicIds ? { topicIds: idea.target.topicIds } : {}),
        },
      }
    : {}),
  ...(idea.title ? { title: idea.title } : {}),
});

/** True when the run already wrote its own proposal Daily Brief in-run. */
const hasWrittenProposalBrief = (mutations: SelfIterationCompletionPayload['mutations']) =>
  mutations.some((mutation) => {
    if (mutation.apiName !== 'createSelfReviewProposal') return false;
    const data = mutation.data as { status?: unknown } | undefined;

    return !isSkippedStatus(data?.status);
  });

/**
 * Projects one `ideas` Daily Brief for a nightly review that recorded ideas but
 * wrote no proposal brief — otherwise those ideas only live on the receipt and
 * the user never sees the night's outcome.
 */
const writeNightlyIdeasBrief = async ({
  ideasBrief,
  selfIteration,
  sourceId,
}: {
  ideasBrief: SelfIterationIdeasBriefOptions;
  selfIteration: SelfIterationCompletionPayload;
  sourceId: string;
}) => {
  const { artifacts, marker, mutations, userId } = selfIteration;
  if (marker.kind !== 'nightly-review') return;
  // The run executes as the builtin reviewer; the brief belongs to the reviewed agent.
  if (!marker.agentId) return;
  if (hasWrittenProposalBrief(mutations)) return;

  const ideas = getIdeas(artifacts).map(toSelfReviewIdea);
  if (ideas.length === 0) return;

  const reviewWindowEnd = marker.reviewWindowEnd ?? new Date().toISOString();
  const reviewWindowStart = marker.reviewWindowStart ?? reviewWindowEnd;

  const brief = createBriefSelfReviewService().projectNightlyReviewBrief({
    agentId: marker.agentId,
    ideas,
    localDate: marker.localDate ?? reviewWindowEnd.slice(0, 10),
    result: {
      actions: [],
      sourceId,
      status: ReviewRunStatus.Completed,
      summaryReceiptId: `${sourceId}:self-iteration-summary`,
    },
    reviewWindowEnd,
    reviewWindowStart,
    t: await ideasBrief.resolveTranslator?.(),
    timezone: 'UTC',
    userId,
  });
  if (!brief) return;

  await ideasBrief.writer.writeDailyBrief(brief);
  log('[completion-handler] wrote ideas brief (%d idea(s)) for source=%s', ideas.length, sourceId);
};

/**
 * Builds the `onSelfIterationCompleted` callback wired into the completion
 * policy. After a background self-iteration run finishes, it projects the run's
 * finalState tool outcomes (carried on the completion source payload) into
 * user-visible receipts and persists them — the execAgent replacement for the
 * old in-runtime receipt accumulator. A nightly review that only recorded ideas
 * additionally gets one `ideas` Daily Brief.
 *
 * Idempotent: `buildSelfIterationReceipts` derives deterministic receipt ids
 * from the source id + tool call ids, and the receipt store dedupes by id, so a
 * replayed completion event re-projects to the same receipts. The brief writer
 * reuses an unresolved ideas brief for the same agent + local date.
 */
export const createSelfIterationCompletionHandler =
  ({ ideasBrief, receiptStore }: SelfIterationCompletionHandlerOptions = {}) =>
  async (params: CompletionCallbackParams): Promise<void> => {
    const { agentId, operationId, selfIteration, topicId } = params;
    if (!selfIteration) return;

    const { artifacts, marker, mutations, userId } = selfIteration;
    const sourceId = marker.sourceId ?? operationId;
    const resolvedTopicId = topicId ?? marker.topicId ?? sourceId;

    const receipts = buildSelfIterationReceipts({
      agentId,
      artifacts,
      createdAt: Date.now(),
      marker,
      mutations,
      operationId,
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
      topicId: resolvedTopicId,
      userId,
    });

    log(
      '[completion-handler] projecting %d receipt(s) for op=%s kind=%s (artifacts=%d mutations=%d)',
      receipts.length,
      operationId,
      marker.kind,
      artifacts.length,
      mutations.length,
    );

    await persistAgentSignalReceipts(receipts, receiptStore ? { store: receiptStore } : {});

    log('[completion-handler] persisted %d receipt(s) for op=%s', receipts.length, operationId);

    if (!ideasBrief) return;

    try {
      await writeNightlyIdeasBrief({ ideasBrief, selfIteration, sourceId });
    } catch (error) {
      // Non-fatal: receipts are already persisted and downstream completion work
      // (expertise ingestion) must still run.
      console.error('[completion-handler] failed to write nightly ideas brief', {
        error,
        operationId,
        sourceId,
      });
    }
  };
