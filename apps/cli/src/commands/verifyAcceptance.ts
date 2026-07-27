import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { getAuthInfo } from '../api/http';
import { outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { attachAcceptanceRunCommands } from './acceptanceRun';
import { parseSubjectRef } from './verifyHelpers';

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
  if (userReview.action === 'ignore') return pc.dim('⊘ ignored');
  return userReview.stale ? pc.dim('· pending') : pc.red('✗ rejected');
};

interface AcceptanceWatchBundle {
  acceptance: { id: string; requirement?: string | null; status: string };
  checks: {
    id: string;
    result?: unknown;
    reviews: {
      action: string;
      annotations?: { comment?: string; evidenceId: string }[];
      comment?: string | null;
      fileIds?: string[];
      roundIndex: number;
    }[];
    seq?: number;
    state: string;
    title?: string;
    userReview?: { action: string; stale: boolean } | null;
  }[];
  rounds: {
    report?: { verdict?: string | null } | null;
    run: {
      decisionDetail?: {
        comment?: string;
        feedbackSubmittedAt?: string;
        groupFeedback?: {
          category: string;
          comment: string;
          fileIds?: string[];
        }[];
      } | null;
      roundIndex?: number | null;
      status?: string | null;
      userDecision?: string | null;
    };
  }[];
  subject: { id: string; title?: string | null; type: string };
}

type AcceptanceWatchTerminal = 'accepted' | 'feedback-submitted';

class AcceptanceWatchRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Read one SSE connection until its terminal acceptance event or EOF. */
const readAcceptanceEvent = async (
  url: URL,
  headers: Record<string, string>,
): Promise<AcceptanceWatchTerminal | null> => {
  const response = await fetch(url, { headers: { ...headers, Accept: 'text/event-stream' } });
  if (!response.ok) {
    throw new AcceptanceWatchRequestError(
      `Acceptance watch request failed (${response.status})`,
      response.status,
    );
  }
  if (!response.body) throw new AcceptanceWatchRequestError('Acceptance watch returned no stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = block
        .split('\n')
        .find((line) => line.startsWith('event:'))
        ?.slice('event:'.length)
        .trim();
      if (event === 'acceptance.accepted') return 'accepted';
      if (event === 'acceptance.feedbackSubmitted') return 'feedback-submitted';
      boundary = buffer.indexOf('\n\n');
    }

    if (done) return null;
  }
};

const resolveWatchTerminal = (
  bundle: AcceptanceWatchBundle,
  roundIndex: number,
): AcceptanceWatchTerminal | null => {
  if (bundle.acceptance.status === 'accepted') return 'accepted';
  const round = bundle.rounds.find((item) => item.run.roundIndex === roundIndex);
  return round?.run.decisionDetail?.feedbackSubmittedAt ? 'feedback-submitted' : null;
};

const watchResult = (bundle: AcceptanceWatchBundle, roundIndex: number) => {
  const round = bundle.rounds.find((item) => item.run.roundIndex === roundIndex);
  if (!round) throw new Error(`Acceptance round ${roundIndex} was not found`);

  const acceptedChecks = bundle.checks.filter((check) => check.userReview?.action === 'accept');
  const rejectedChecks = bundle.checks.flatMap((check) => {
    const review = [...check.reviews]
      .reverse()
      .find((item) => item.action === 'reject' && item.roundIndex === roundIndex);
    return review ? [{ check, review }] : [];
  });

  return {
    acceptanceId: bundle.acceptance.id,
    acceptedChecks: acceptedChecks.map((check) => ({
      id: check.id,
      seq: check.seq,
      title: check.title,
    })),
    feedbackSubmittedAt: round.run.decisionDetail?.feedbackSubmittedAt,
    groupFeedback: round.run.decisionDetail?.groupFeedback ?? [],
    overallComment: round.run.decisionDetail?.comment,
    rejectedChecks: rejectedChecks.map(({ check, review }) => ({
      annotations: review.annotations,
      comment: review.comment,
      fileIds: review.fileIds,
      id: check.id,
      seq: check.seq,
      title: check.title,
    })),
    roundIndex,
    status: bundle.acceptance.status,
    subject: bundle.subject,
  };
};

const checkLabel = (check: { id: string; seq?: number; title?: string }): string =>
  `${check.seq ? `C${check.seq} ` : ''}[${check.id}]${check.title ? ` ${check.title}` : ''}`;

const printWatchResult = (
  bundle: AcceptanceWatchBundle,
  roundIndex: number,
  terminal: AcceptanceWatchTerminal,
  json = false,
): void => {
  const result = watchResult(bundle, roundIndex);
  if (json) {
    console.log(JSON.stringify({ terminal, ...result }));
    return;
  }

  const subject = result.subject.title ?? result.subject.id;
  if (terminal === 'accepted') {
    console.log(
      `ACCEPTANCE ACCEPTED — ${subject} (${result.acceptanceId}) · round ${roundIndex}\n\nNo further repair is required.`,
    );
    return;
  }

  const lines = [`FEEDBACK SUBMITTED — ${subject} (${result.acceptanceId}) · round ${roundIndex}`];
  if (result.acceptedChecks.length > 0) {
    lines.push('', 'Accepted — keep settled, do not rerun');
    for (const check of result.acceptedChecks) lines.push(`- ${checkLabel(check)}`);
  }
  if (result.rejectedChecks.length > 0) {
    lines.push('', 'Needs repair');
    for (const check of result.rejectedChecks) {
      lines.push(`- ${checkLabel(check)}`);
      if (check.comment) lines.push(`  ${check.comment}`);
      for (const annotation of check.annotations ?? []) {
        if (annotation.comment) {
          lines.push(`  Region on evidence ${annotation.evidenceId}: ${annotation.comment}`);
        }
      }
      if (check.fileIds?.length) lines.push(`  Attachments: ${check.fileIds.join(', ')}`);
    }
  }
  for (const feedback of result.groupFeedback) {
    lines.push('', `Group feedback — ${feedback.category || 'overall'}`, `- ${feedback.comment}`);
    if (feedback.fileIds?.length) lines.push(`  Attachments: ${feedback.fileIds.join(', ')}`);
  }
  if (result.overallComment) lines.push('', 'Overall', `- ${result.overallComment}`);
  if (
    result.rejectedChecks.length === 0 &&
    result.groupFeedback.length === 0 &&
    !result.overallComment
  ) {
    lines.push('', 'No repair instructions were recorded.');
  }
  console.log(lines.join('\n'));
};

async function watchAcceptance(
  idOrSubject: string,
  options: { json?: boolean; round?: string },
): Promise<void> {
  const id = await resolveAcceptanceId(idOrSubject);
  const client = await getTrpcClient();
  let bundle = (await client.acceptance.getBundle.query({ id })) as AcceptanceWatchBundle;
  const roundIndex = options.round ? Number(options.round) : bundle.rounds.at(-1)?.run.roundIndex;
  if (!roundIndex || !Number.isInteger(roundIndex) || roundIndex < 1) {
    throw new Error('--round must identify a positive acceptance round');
  }

  let terminal = resolveWatchTerminal(bundle, roundIndex);
  if (!terminal) {
    const { headers, serverUrl } = await getAuthInfo();
    const url = new URL('/webapi/acceptance/events', serverUrl);
    url.searchParams.set('id', id);
    url.searchParams.set('round', String(roundIndex));

    while (!terminal) {
      try {
        terminal = await readAcceptanceEvent(url, headers);
      } catch (error) {
        if (
          error instanceof AcceptanceWatchRequestError &&
          error.status !== undefined &&
          [400, 401, 403, 404].includes(error.status)
        ) {
          throw error;
        }
        log.warn(`Acceptance watch disconnected: ${(error as Error).message}; reconnecting`);
      }
      if (terminal) break;
      log.warn('Acceptance watch stream closed before a decision; reconnecting');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    bundle = (await client.acceptance.getBundle.query({ id })) as AcceptanceWatchBundle;
    terminal = resolveWatchTerminal(bundle, roundIndex) ?? terminal;
  }

  printWatchResult(bundle, roundIndex, terminal, options.json);
}

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
    .command('watch <idOrSubject>')
    .description('Wait for submitted feedback or final acceptance, then exit once')
    .option('--round <index>', 'Immutable acceptance round to watch')
    .option('--json', 'Output the terminal result as JSON')
    .action(watchAcceptance);

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

  // The canonical `lh acceptance init` + `lh acceptance run …` tree hangs off the
  // first-class command only; the legacy `lh verify acceptance` alias stays a thin
  // decision surface (its run commands keep their old `lh verify …` spellings).
  if (!options?.deprecated) attachAcceptanceRunCommands(acceptance);
}
