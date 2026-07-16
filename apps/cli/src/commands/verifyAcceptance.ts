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

export function registerAcceptanceCommands(verify: Command) {
  const acceptance = verify
    .command('acceptance')
    .description(
      'Manage subject-level delivery acceptances (the cross-round union of verify sessions)',
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
