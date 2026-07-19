import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { parseSubjectRef } from './verify';

/**
 * Resolve an acceptance from either its uuid or a `type:id` subject reference —
 * the subject form is what a harness naturally holds (it knows what it tested,
 * not the aggregate's id).
 */
async function resolveAcceptanceId(ref: string): Promise<string> {
  const subject = parseSubjectRef(ref);
  if (!subject) return ref;

  const client = await getTrpcClient();
  const acceptance = await client.acceptance.getBySubject.query({
    subjectId: subject.subjectId,
    subjectType: subject.subjectType,
  });
  if (!acceptance) {
    log.error(`No acceptance found for ${ref}`);
    process.exit(1);
  }
  return acceptance.id;
}

const stateGlyph = (state: string): string => {
  if (state === 'passed') return pc.green('✓ passed');
  if (state === 'failed') return pc.red('✗ failed');
  if (state === 'uncertain') return pc.yellow('? uncertain');
  return pc.dim('· not executed');
};

const statusColor = (status: string): string => {
  if (status === 'accepted') return pc.green(status);
  if (status === 'rejected') return pc.red(status);
  if (status === 'delivered') return pc.yellow(status);
  return pc.dim(status);
};

/** The user's standing verdict on one union check, for the USER column. */
const userGlyph = (userReview?: { action: string; stale: boolean } | null): string => {
  if (!userReview) return pc.dim('· pending');
  if (userReview.action === 'accept') return pc.green('✓ accepted');
  return userReview.stale ? pc.dim('· pending') : pc.red('✗ rejected');
};

/**
 * The acceptance command set. Registered twice: as the first-class
 * `lh acceptance` (the canonical spelling — the acceptance is the human-review
 * loop's front door, not a verify implementation detail) and as the legacy
 * `lh verify acceptance` alias existing docs/skills still reference.
 */
export function registerAcceptanceCommands(parent: Command, options?: { deprecated?: boolean }) {
  const acceptance = parent
    .command('acceptance')
    .description(
      options?.deprecated
        ? 'Deprecated alias — use `lh acceptance`'
        : 'Delivery acceptances: the cross-round review loop (checks, feedback, decision)',
    );

  acceptance
    .command('list')
    .description('List acceptances, newest first')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const items = await client.acceptance.list.query();

      if (options.json !== undefined) {
        outputJson(items, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (items.length === 0) {
        console.log(pc.dim('No acceptances yet.'));
        return;
      }
      printTable(
        items.map((a) => [
          a.id,
          `${a.subjectType}:${truncate(a.subjectId, 24)}`,
          statusColor(a.status),
          truncate(a.requirement ?? '', 40),
          timeAgo(a.createdAt),
        ]),
        ['ID', 'SUBJECT', 'STATUS', 'REQUIREMENT', 'CREATED'],
      );
    });

  acceptance
    .command('view <idOrSubject>')
    .description('Show the acceptance decision bundle (union checks + round ledger)')
    .option('--json [fields]', 'Output JSON')
    .action(async (idOrSubject: string, options: { json?: boolean | string }) => {
      const id = await resolveAcceptanceId(idOrSubject);
      const client = await getTrpcClient();
      const bundle = await client.acceptance.getBundle.query({ id });

      if (options.json !== undefined) {
        outputJson(bundle, typeof options.json === 'string' ? options.json : undefined);
        return;
      }

      const { acceptance: agg, checks, latestReport, rounds, subject } = bundle;
      console.log(
        `${pc.bold(subject.title ?? subject.id)} ${pc.dim(`(${subject.type}:${subject.id})`)}`,
      );
      console.log(
        `${pc.bold('status')}: ${statusColor(agg.status)}   ${pc.bold('rounds')}: ${rounds.length}`,
      );
      if (agg.requirement) console.log(`${pc.bold('requirement')}: ${agg.requirement}`);
      if (latestReport?.summary) console.log(`${pc.bold('summary')}: ${latestReport.summary}`);

      console.log();
      printTable(
        checks.map((c) => [
          `C${c.seq}`,
          truncate(c.title, 46),
          stateGlyph(c.state),
          userGlyph(c.userReview),
          c.required ? 'gate' : 'soft',
          c.surface ?? '',
          c.fixed
            ? 'fixed'
            : c.carriedFromRound !== undefined
              ? `carried r${c.carriedFromRound}`
              : '',
          c.history.map((h) => `r${h.roundIndex}:${h.state}`).join(' → '),
        ]),
        ['C#', 'CHECK', 'FINAL', 'USER', 'BLOCK', 'SURFACE', 'NOTE', 'HISTORY'],
      );

      // The user's feedback trail — what the next verification round must act
      // on. Standing rejects first (actionable now), then consumed history.
      const withFeedback = checks.filter((c) => c.reviews.some((r) => r.action === 'reject'));
      if (withFeedback.length > 0) {
        console.log();
        console.log(pc.bold('user feedback'));
        for (const c of withFeedback) {
          for (const review of c.reviews) {
            if (review.action !== 'reject') continue;
            const standing =
              c.userReview && !c.userReview.stale ? c.reviews.at(-1) === review : false;
            const marker = standing ? pc.red('▶ actionable') : pc.dim('· addressed');
            console.log(
              `  ${marker} C${c.seq} ${truncate(c.title, 60)} ${pc.dim(`[${c.id}] (r${review.roundIndex})`)}`,
            );
            if (review.comment) console.log(`      ${review.comment}`);
            for (const annotation of review.annotations ?? []) {
              if (annotation.comment)
                console.log(`      ${pc.dim('region:')} ${annotation.comment}`);
            }
          }
        }
      }

      console.log();
      printTable(
        rounds.map((r) => [
          `r${r.run.roundIndex}`,
          r.run.status ?? (r.report ? 'settled' : 'open'),
          r.report?.verdict ?? '',
          `${r.report?.passedChecks ?? '-'}/${r.report?.totalChecks ?? '-'}`,
          r.run.userDecision ?? '',
          timeAgo(r.run.createdAt),
        ]),
        ['ROUND', 'STATUS', 'VERDICT', 'PASSED', 'DECISION', 'CREATED'],
      );
    });

  acceptance
    .command('feedback <idOrSubject>')
    .description(
      "The user's review feedback — check rejects (with region notes & attachments) plus group-scoped notes",
    )
    .option('--actionable', 'Only standing feedback the next repair round must act on')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (idOrSubject: string, options: { actionable?: boolean; json?: boolean | string }) => {
        const id = await resolveAcceptanceId(idOrSubject);
        const client = await getTrpcClient();
        const bundle = await client.acceptance.getBundle.query({ id });

        const currentRoundIndex = bundle.rounds.at(-1)?.run.roundIndex ?? 0;

        interface FeedbackEntry {
          actionable: boolean;
          annotations?: { comment?: string }[];
          category?: string;
          checkId?: string;
          checkSeq?: number;
          comment: string;
          createdAt?: string;
          fileIds?: string[];
          kind: 'check' | 'group';
          roundIndex: number;
          title?: string;
        }

        const entries: FeedbackEntry[] = [];
        for (const check of bundle.checks) {
          for (const review of check.reviews) {
            if (review.action !== 'reject') continue;
            // Standing = this reject is the check's latest verdict and no newer
            // round has consumed it yet.
            const standing = Boolean(
              check.userReview &&
              check.userReview.action === 'reject' &&
              !check.userReview.stale &&
              check.reviews.at(-1) === review,
            );
            entries.push({
              actionable: standing,
              annotations: review.annotations?.map((a) => ({ comment: a.comment })),
              checkId: check.id,
              checkSeq: check.seq,
              comment: review.comment ?? '',
              createdAt: review.createdAt,
              fileIds: review.fileIds,
              kind: 'check',
              roundIndex: review.roundIndex,
              title: check.title,
            });
          }
        }
        for (const round of bundle.rounds) {
          for (const entry of round.run.decisionDetail?.groupFeedback ?? []) {
            const roundIndex = round.run.roundIndex ?? 0;
            entries.push({
              actionable: roundIndex >= currentRoundIndex,
              category: entry.category,
              comment: entry.comment,
              createdAt: entry.createdAt,
              fileIds: entry.fileIds,
              kind: 'group',
              roundIndex,
            });
          }
        }
        entries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

        const shown = options.actionable ? entries.filter((entry) => entry.actionable) : entries;

        if (options.json !== undefined) {
          outputJson(
            { acceptanceId: id, currentRoundIndex, entries: shown },
            typeof options.json === 'string' ? options.json : undefined,
          );
          return;
        }

        if (shown.length === 0) {
          console.log(pc.dim(options.actionable ? 'No actionable feedback.' : 'No feedback yet.'));
          return;
        }
        for (const entry of shown) {
          const marker = entry.actionable ? pc.red('▶ actionable') : pc.dim('· addressed');
          const label =
            entry.kind === 'check'
              ? `C${entry.checkSeq} ${truncate(entry.title ?? '', 60)}`
              : `group · ${entry.category || 'overall'}`;
          console.log(`${marker} ${label} ${pc.dim(`(r${entry.roundIndex})`)}`);
          if (entry.comment) console.log(`    ${entry.comment}`);
          for (const annotation of entry.annotations ?? []) {
            if (annotation.comment) console.log(`    ${pc.dim('region:')} ${annotation.comment}`);
          }
          if (entry.fileIds?.length)
            console.log(`    ${pc.dim(`attachments: ${entry.fileIds.join(', ')}`)}`);
        }
      },
    );

  acceptance
    .command('accept <idOrSubject>')
    .description('Accept the delivery — the terminal user decision that closes the acceptance')
    .option('--comment <text>', 'Optional note recorded with the decision')
    .option('--json [fields]', 'Output JSON')
    .action(async (idOrSubject: string, options: { comment?: string; json?: boolean | string }) => {
      const id = await resolveAcceptanceId(idOrSubject);
      const client = await getTrpcClient();
      const result = await client.acceptance.accept.mutate({ comment: options.comment, id });

      if (options.json !== undefined) {
        outputJson(result, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      console.log(`${pc.green('✓')} Delivery accepted (${result.id})`);
    });

  acceptance
    .command('reject <idOrSubject>')
    .description('Reject the delivery — the comment seeds the next repair round')
    .requiredOption('--comment <text>', 'Why the delivery is rejected (the re-tasking input)')
    .option('--json [fields]', 'Output JSON')
    .action(async (idOrSubject: string, options: { comment: string; json?: boolean | string }) => {
      const id = await resolveAcceptanceId(idOrSubject);
      const client = await getTrpcClient();
      const result = await client.acceptance.reject.mutate({ comment: options.comment, id });

      if (options.json !== undefined) {
        outputJson(result, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      console.log(`${pc.red('✗')} Delivery rejected (${result.id}) — next round re-opens it`);
    });
}
