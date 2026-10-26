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
import { writeAcceptanceInfo } from './acceptanceDir';
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
  skipped: { checkId: string; reason: string }[];
  uploaded: number;
}

/**
 * Carry the reviewer's standing decisions onto the published acceptance, so
 * collaborators open it where the local review left off. Only the current
 * verdict of each check moves (a reject a later round consumed stays local
 * history), and a circled region is re-pointed at the same artifact's upload.
 */
async function carryReviews(
  client: TrpcClient,
  read: LocalAcceptanceRead,
  remote: LocalAcceptanceRemote,
): Promise<ReviewCarry> {
  const carry: ReviewCarry = { skipped: [], uploaded: 0 };
  const local = assembleLocalAcceptance(read.source);
  const standing = local.checks.filter((check) => check.userReview && !check.userReview.stale);
  const groupFeedback = local.rounds.at(-1)?.run.decisionDetail?.groupFeedback ?? [];
  if (standing.length === 0 && groupFeedback.length === 0) return carry;

  const bundle: RemoteBundle = await client.acceptance.getBundle.query({
    id: remote.acceptanceId,
  });
  // Plan item ids survive publication; the remote row id is the criterion minted for it.
  const remoteCheck = new Map(
    bundle.checks.map((check) => [check.planItem?.id ?? check.id, check]),
  );
  const remoteRunByDir = new Map(remote.rounds.map((round) => [round.dir, round.verifyRunId]));
  const dirByLocalRun = new Map(read.source.rounds.map((round) => [round.run.id, round.dir]));

  /** A local artifact → the same artifact's upload: its round, its check, its position. */
  const remoteEvidenceId = (evidenceId: string): string | undefined => {
    for (const check of local.checks) {
      for (const entry of check.timeline) {
        const position = entry.evidence.findIndex((item) => item.id === evidenceId);
        if (position === -1) continue;
        const runId = remoteRunByDir.get(dirByLocalRun.get(entry.verifyRunId) ?? '');
        const target = bundle.checks
          .find((item) => item.planItem?.id === (check.planItem?.id ?? check.id))
          ?.timeline.find((step) => step.verifyRunId === runId);
        return target?.evidence[position]?.id;
      }
    }
    return undefined;
  };

  for (const check of standing) {
    const review = check.userReview!;
    const target = remoteCheck.get(check.planItem?.id ?? check.id);
    if (!target?.result) {
      carry.skipped.push({ checkId: check.id, reason: 'not on the published acceptance' });
      continue;
    }
    const annotations = (review.annotations ?? []).flatMap(
      (annotation): AcceptanceReviewAnnotation[] => {
        const evidenceId = remoteEvidenceId(annotation.evidenceId);
        return evidenceId ? [{ ...annotation, evidenceId }] : [];
      },
    );
    // A region on an artifact that failed to upload cannot be placed; keep its words.
    const lostNotes = (review.annotations ?? [])
      .filter((annotation) => !remoteEvidenceId(annotation.evidenceId) && annotation.comment)
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
      carry.uploaded++;
    } catch (error) {
      carry.skipped.push({
        checkId: `group:${entry.category}`,
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
            ...(subject.type === 'standalone' ? {} : { subject: `${subject.type}:${subject.id}` }),
          }),
      quiet: true,
      source: options.source ?? 'agent-testing',
    });
    if (!summary) throw new Error(`${round.dir} was not published as an authored round`);
    results.push({ dir: round.dir, summary });
    remote = {
      acceptanceId: summary.acceptanceId,
      acceptanceUrl: summary.acceptanceUrl,
      rounds: [
        ...(remote?.rounds ?? []),
        { dir: round.dir, roundIndex: summary.roundIndex, verifyRunId: summary.verifyRunId },
      ],
    };
    // Recorded per round: an interrupted publish resumes after the last one that landed.
    writeAcceptanceInfo(acceptanceDir, { ...info, remote });
  }

  if (!remote) {
    log.error(`${acceptanceDir} has no round to publish`);
    process.exit(1);
  }

  const reviews =
    options.reviews === false
      ? { skipped: [], uploaded: 0 }
      : await carryReviews(client, read, remote);
  for (const skipped of reviews.skipped)
    log.warn(`review of ${skipped.checkId} not carried over: ${skipped.reason}`);

  const partial = results.some(({ summary }) => summary.publicationStatus === 'partial');
  if (partial) process.exitCode = 1;
  const output = {
    acceptanceId: remote.acceptanceId,
    acceptanceUrl: remote.acceptanceUrl,
    alreadyPublished: [...published],
    published: results.map(({ dir, summary }) => ({
      dir,
      publicationStatus: summary.publicationStatus,
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
