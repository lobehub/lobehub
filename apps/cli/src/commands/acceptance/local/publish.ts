import path from 'node:path';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import type { LocalAcceptanceRemote } from '@lobechat/utils/verify/localAcceptance';
import {
  assembleLocalAcceptance,
  localSubjectFromKey,
} from '@lobechat/utils/verify/localAcceptance';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient, type TrpcClient } from '../../../api/client';
import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { ingestReportAction, type IngestReportSummary } from '../run/ingest';
import { ReportRoundError } from '../run/reportRound';
import { localEvidenceId, writeAcceptanceInfo } from './acceptanceDir';
import { loadLocalAcceptance, type LocalAcceptanceRead } from './localAcceptance';

export interface PublishOptions {
  json?: boolean | string;
  requirement?: string;
  /** commander's `--no-reviews` */
  reviews?: boolean;
  source?: string;
}

type RemoteBundle = Awaited<ReturnType<TrpcClient['acceptance']['getBundle']['query']>>;

interface ReviewCarry {
  /** Decisions that landed this time, recorded so a re-publish skips them. */
  carried: string[];
  skipped: { checkId: string; reason: string }[];
  uploaded: number;
}

/**
 * Carry the reviewer's standing decisions onto the published acceptance, so
 * collaborators open it where the local review left off. Only the current
 * verdict of each check moves (a reject a later round consumed stays local
 * history), and a circled region is re-pointed at the same artifact's upload.
 * Each decision moves once: replaying it on a later publish would overwrite
 * whatever a collaborator decided online since.
 */
async function carryReviews(
  client: TrpcClient,
  read: LocalAcceptanceRead,
  remote: LocalAcceptanceRemote,
): Promise<ReviewCarry> {
  const carry: ReviewCarry = { carried: [], skipped: [], uploaded: 0 };
  const done = new Set(remote.carriedReviews);
  const local = assembleLocalAcceptance(read.source);
  const checkKey = (check: (typeof local.checks)[number]) => check.planItem?.id ?? check.id;
  const standing = local.checks
    .filter((check) => check.userReview && !check.userReview.stale)
    .map((check) => ({ check, key: `check:${checkKey(check)}@${check.userReview!.createdAt}` }))
    .filter(({ key }) => !done.has(key));
  const latestRoundIndex = local.rounds.at(-1)?.run.roundIndex;
  const groupFeedback = read.source.reviews.filter(
    (event): event is Extract<typeof event, { kind: 'group' }> =>
      event.kind === 'group' &&
      event.roundIndex === latestRoundIndex &&
      !done.has(`group:${event.id}`),
  );
  // The delivery decision of the latest round moves last, once its feedback is
  // there: it is what closes (or sends back) the published acceptance.
  const decision = read.source.reviews.findLast(
    (event): event is Extract<typeof event, { kind: 'decision' }> =>
      event.kind === 'decision' && event.roundIndex === latestRoundIndex,
  );
  const pendingDecision = decision && !done.has(`decision:${decision.id}`) ? decision : undefined;
  if (standing.length === 0 && groupFeedback.length === 0 && !pendingDecision) return carry;

  const bundle: RemoteBundle = await client.acceptance.getBundle.query({
    id: remote.acceptanceId,
  });
  // Plan item ids survive publication; the remote row id is the criterion minted for it.
  const remoteCheck = new Map(
    bundle.checks.map((check) => [check.planItem?.id ?? check.id, check]),
  );
  // Matched by identity: a failed upload leaves no entry rather than shifting the rest.
  const remoteEvidence = new Map(
    remote.rounds.flatMap((round) => Object.entries(round.evidence ?? {})),
  );

  for (const { check, key } of standing) {
    const review = check.userReview!;
    const target = remoteCheck.get(checkKey(check));
    if (!target?.result) {
      carry.skipped.push({ checkId: check.id, reason: 'not on the published acceptance' });
      continue;
    }
    const annotations = (review.annotations ?? []).flatMap(
      (annotation): AcceptanceReviewAnnotation[] => {
        const evidenceId = remoteEvidence.get(annotation.evidenceId);
        return evidenceId ? [{ ...annotation, evidenceId }] : [];
      },
    );
    // A region on an artifact that failed to upload cannot be placed; keep its words.
    const lostNotes = (review.annotations ?? [])
      .filter((annotation) => !remoteEvidence.has(annotation.evidenceId) && annotation.comment)
      .map((annotation) => annotation.comment!);
    const comment = [review.comment, ...lostNotes].filter(Boolean).join('\n') || undefined;
    try {
      await client.acceptance.reviewChecks.mutate({
        action: review.action,
        ...(annotations.length > 0 ? { annotations } : {}),
        checkItemIds: [target.id],
        comment,
        id: remote.acceptanceId,
      });
      carry.carried.push(key);
      carry.uploaded++;
    } catch (error) {
      carry.skipped.push({
        checkId: check.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const entry of groupFeedback) {
    try {
      await client.acceptance.addGroupFeedback.mutate({
        category: entry.category,
        comment: entry.comment,
        id: remote.acceptanceId,
      });
      carry.carried.push(`group:${entry.id}`);
      carry.uploaded++;
    } catch (error) {
      carry.skipped.push({
        checkId: `group:${entry.category}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const latestDir = [...read.source.rounds]
    .sort((a, b) => a.run.roundIndex - b.run.roundIndex)
    .at(-1)?.dir;
  const roundId = remote.rounds.find((round) => round.dir === latestDir)?.verifyRunId;
  // Bound to the round it judged. The server checks `roundId` only for some
  // subjects and otherwise stamps whatever round is newest, so a decision on a
  // round that is no longer the published acceptance's current one is refused
  // here rather than landing on a delivery nobody reviewed.
  if (pendingDecision && (!roundId || bundle.rounds.at(-1)?.run.id !== roundId)) {
    carry.skipped.push({
      checkId: `decision:${pendingDecision.action}`,
      reason: 'the published acceptance has a newer round than the one this decision judged',
    });
  } else if (pendingDecision) {
    try {
      if (pendingDecision.action === 'accept')
        await client.acceptance.accept.mutate({
          comment: pendingDecision.comment,
          id: remote.acceptanceId,
          roundId,
        });
      // Recorded only: the reviewer already handed the repair prompt over locally.
      else
        await client.acceptance.reject.mutate({
          comment: pendingDecision.comment,
          dispatch: false,
          id: remote.acceptanceId,
          roundId,
        });
      carry.carried.push(`decision:${pendingDecision.id}`);
      carry.uploaded++;
    } catch (error) {
      carry.skipped.push({
        checkId: `decision:${pendingDecision.action}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return carry;
}

/**
 * Publish a local acceptance to LobeHub, for when the delivery needs other
 * eyes: every round not yet published goes through `ingest`, oldest first,
 * into one acceptance, keeping its immutable history; then the reviewer's
 * standing decisions follow. Re-running publishes only the rounds added since.
 */
export async function publishAction(target: string, options: PublishOptions) {
  // Fail on missing credentials before reading anything.
  const client = await getTrpcClient();

  let read: LocalAcceptanceRead;
  try {
    read = loadLocalAcceptance(target, { create: true, requirement: options.requirement });
  } catch (error) {
    if (error instanceof ReportRoundError) {
      for (const line of error.lines) log.error(line);
      process.exit(1);
    }
    throw error;
  }
  const { acceptanceDir, info } = read;
  let remote = info.remote;
  const published = new Set(remote?.rounds.map((round) => round.dir));
  const pending = read.source.rounds.filter((round) => !published.has(round.dir));
  const subject = localSubjectFromKey(info.subjectKey);
  const results: { dir: string; summary: IngestReportSummary }[] = [];

  for (const round of pending) {
    const summary = await ingestReportAction(path.join(acceptanceDir, round.dir), {
      ...(remote
        ? { acceptance: remote.acceptanceId }
        : {
            requirement: info.requirement ?? undefined,
            ...(subject.type === 'standalone'
              ? { fallbackSubject: { subjectId: info.id, subjectType: 'standalone' as const } }
              : { subject: `${subject.type}:${subject.id}` }),
          }),
      quiet: true,
      source: options.source ?? 'agent-testing',
    });
    if (!summary) throw new Error(`${round.dir} was not published as an authored round`);
    results.push({ dir: round.dir, summary });
    remote = {
      ...remote,
      acceptanceId: summary.acceptanceId,
      acceptanceUrl: summary.acceptanceUrl,
      rounds: [
        ...(remote?.rounds ?? []),
        {
          dir: round.dir,
          evidence: Object.fromEntries(
            summary.publishedEvidence.map((item) => [
              localEvidenceId(info.id, round.dir, item.checkItemId, item.position),
              item.evidenceId,
            ]),
          ),
          roundIndex: summary.roundIndex,
          verifyRunId: summary.verifyRunId,
        },
      ],
    };
    // Recorded per round: an interrupted publish resumes after the last one that landed.
    writeAcceptanceInfo(acceptanceDir, { ...info, remote });
  }

  if (!remote) {
    log.error(`${acceptanceDir} has no round to publish`);
    process.exit(1);
  }

  const { carried, ...reviews } =
    options.reviews === false
      ? { carried: [], skipped: [], uploaded: 0 }
      : await carryReviews(client, read, remote);
  for (const skipped of reviews.skipped)
    log.warn(`review of ${skipped.checkId} not carried over: ${skipped.reason}`);
  if (carried.length > 0) {
    remote = { ...remote, carriedReviews: [...(remote.carriedReviews ?? []), ...carried] };
    writeAcceptanceInfo(acceptanceDir, { ...info, remote });
  }

  const partial = results.some(({ summary }) => summary.publicationStatus === 'partial');
  if (partial) process.exitCode = 1;
  const output = {
    acceptanceId: remote.acceptanceId,
    acceptanceUrl: remote.acceptanceUrl,
    alreadyPublished: [...published],
    published: results.map(({ dir, summary }) => ({
      dir,
      // A partial round is recorded as published and never re-ingested: what
      // repairs it is retrying these artifacts, not publishing again.
      failedEvidence: summary.failedEvidence,
      missingEvidence: summary.missingEvidence,
      publicationStatus: summary.publicationStatus,
      recovery: summary.recovery,
      roundIndex: summary.roundIndex,
      verifyRunId: summary.verifyRunId,
    })),
    publicationStatus: partial ? ('partial' as const) : ('complete' as const),
    reviews,
  };

  if (options.json !== undefined) {
    outputJson(output, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(
    `${partial ? pc.yellow('⚠ Partially published') : pc.green('✓ Published')} ${results.length} round(s)` +
      `${published.size > 0 ? pc.dim(` (${published.size} already published)`) : ''}` +
      `${reviews.uploaded > 0 ? `, ${reviews.uploaded} review decision(s) carried over` : ''}`,
  );
  for (const { dir, summary } of results) {
    for (const failure of summary.failedEvidence) {
      console.log(`${pc.yellow('retry (POSIX shell)')} ${pc.dim(dir)}: ${failure.retryCommand}`);
      console.log(
        `${pc.dim('retryArgs (lh, shell disabled)')}: ${JSON.stringify(failure.retryArgs)}`,
      );
    }
  }
  console.log(`${pc.bold('acceptance')}: ${remote.acceptanceUrl}`);
}

export function withPublishOptions(cmd: Command): Command {
  return cmd
    .option('--source <source>', 'agent | agent-testing', 'agent-testing')
    .option(
      '--requirement <text>',
      'Acceptance requirement, when the local acceptance has none recorded yet',
    )
    .option('--no-reviews', "Publish the rounds only; keep the reviewer's local decisions local")
    .option('--json [fields]', 'Output JSON');
}
