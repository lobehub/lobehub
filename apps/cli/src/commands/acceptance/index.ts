import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { acceptanceSubjectTypes } from '@lobechat/const/verify';
import type { AcceptanceAttachment, AcceptanceCheckGroup } from '@lobechat/types';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { resolveServerUrl } from '../../settings';
import { outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveUrlBuilder, resourcePath, withUrl, withUrls } from '../resourceUrl';
import { collectCommentFeedback } from './commentFeedback';
import { attachCriterionCommands } from './criterion';
import { attachAcceptanceFlowCommands } from './flow';
import {
  assertReportLanguage,
  languageSummary,
  resolveReportLanguage,
  responseLanguageSettingsUrl,
  unsetLanguageWarning,
} from './language';
import { attachPlanCommands } from './plan';
import { projectEnsureInput, resolveAcceptanceProject, warnIfFiledElsewhere } from './project';
import { attachRubricCommands } from './rubric';
import { attachAcceptanceRunCommands } from './run';
import type { ReviewAnnotationRegion } from './utils';
import { formatAnnotationRegion, formatDisputedChapter, parseSubjectRef } from './utils';

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

  attachAcceptanceFlowCommands(acceptance);

  acceptance
    .command('preflight')
    .description(
      'Check that the CLI is authenticated and print the language every acceptance text must be written in. ' +
        'Run it before authoring anything, and pass the language to any subagent you delegate to.',
    )
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      // An auth failure throws here, which is the signal to stop before authoring.
      const language = await resolveReportLanguage(client);
      const instruction =
        language.status === 'unset'
          ? 'No response language is set on this account, so the language is not checked. Write in the language the user converses in.'
          : `Write every human-readable acceptance field (title, plan, case names and observations, evidence descriptions, conclusion, report.md, proposal.md) in ${language.locale}${language.status === 'enforced' ? `, i.e. ${language.rule.languageName}` : ''}. Pass this language explicitly to any subagent you delegate to.`;
      if (options.json !== undefined) {
        outputJson(
          {
            authenticated: true,
            instruction,
            language: languageSummary(language),
            settingsUrl: responseLanguageSettingsUrl(),
          },
          typeof options.json === 'string' ? options.json : undefined,
        );
        return;
      }
      if (language.status === 'unset') log.warn(unsetLanguageWarning());
      console.log(`${pc.green('✓')} Authenticated`);
      console.log(
        `${pc.bold('report language')}: ${language.status === 'unset' ? pc.yellow('not set') : language.locale}${language.status === 'unchecked' ? pc.dim(' (not script-checked)') : ''}`,
      );
      console.log(instruction);
    });

  acceptance
    .command('create')
    .summary('Create or reuse an acceptance without creating a verification round or results')
    .description(
      'Create or reuse an acceptance record. This does not create checks, verification rounds, results, reports, or evidence.\n\n' +
        'Before creating, agents should load and read the acceptance skill (.agents/skills/acceptance/SKILL.md) ' +
        'and follow its workflow. If the skill is missing, run `lh acceptance install`, then read it.\n\n' +
        'Use create for flow-first planning. If a completed local report already exists, use ' +
        '`lh acceptance run ingest <reportDir>` to publish it; a separate create call is unnecessary. ' +
        'An acceptance URL alone does not mean verification is complete: publish results and required evidence, ' +
        'then read back coverage before handing off a completed acceptance.',
    )
    .requiredOption(
      '--requirement <text>',
      'Durable business goal (preserved when reusing a subject)',
    )
    .option('-t, --title <text>', 'Display title for a standalone acceptance')
    .option(
      '--subject <type:id>',
      'Reuse or create for task/topic/document/standalone; omit for a new standalone acceptance',
    )
    .option(
      '--project <ref>',
      "File under a project (id, slug or identifier such as LOBE), overriding the subject's own; otherwise the subject's project, then the one in .agents/acceptance/config.json",
    )
    .option(
      '--json [fields]',
      'Output JSON, optionally select fields (acceptanceId, acceptanceUrl, projectId, requirement, status, subject)',
    )
    .action(
      async (options: {
        json?: boolean | string;
        project?: string;
        requirement: string;
        subject?: string;
        title?: string;
      }) => {
        const requirement = options.requirement.trim();
        const title = options.title?.trim();
        if (!requirement) throw new InvalidArgumentError('--requirement must not be empty');
        if (title === '') throw new InvalidArgumentError('--title must not be empty');

        const subject =
          options.subject === undefined
            ? { subjectId: randomUUID(), subjectType: 'standalone' as const }
            : parseSubjectRef(options.subject);
        if (!subject) {
          throw new InvalidArgumentError(
            `--subject must be one of ${acceptanceSubjectTypes.map((type) => `${type}:<id>`).join(' | ')}`,
          );
        }

        const client = await getTrpcClient();
        await assertReportLanguage(client, [
          { path: '--requirement', text: requirement },
          { path: '--title', text: title },
        ]);
        const project = await resolveAcceptanceProject(client, {
          flag: options.project,
          startDirs: [process.cwd()],
        });
        const result = await client.acceptance.ensure.mutate({
          ...subject,
          ...projectEnsureInput(project),
          requirement,
          title,
        });
        warnIfFiledElsewhere(project, result);
        const acceptanceUrl = new URL(
          `/acceptance/${encodeURIComponent(result.id)}`,
          resolveServerUrl(),
        ).toString();

        if (options.json !== undefined) {
          outputJson(
            {
              acceptanceId: result.id,
              acceptanceUrl,
              projectId: result.projectId,
              requirement: result.requirement,
              status: result.status,
              subject: { subjectId: result.subjectId, subjectType: result.subjectType },
            },
            typeof options.json === 'string' ? options.json : undefined,
          );
          return;
        }

        console.log(`${pc.bold('acceptance')}: ${result.id} (${result.status})`);
        if (project && result.projectId === project.id) {
          console.log(`${pc.bold('project')}: ${project.name}`);
        }
        console.log(`${pc.bold('open acceptance')}: ${acceptanceUrl}`);
        console.log(
          pc.dim(
            'No verification round or results created. Use `lh acceptance flow publish` to add a plan.',
          ),
        );
      },
    );

  acceptance
    .command('regroup <idOrSubject>')
    .description('Change checklist business groups while preserving checks, evidence and history')
    .requiredOption('--file <path>', 'JSON: expectedVersion and groups [{ title, checkItemIds }]')
    .action(async (ref: string, options: { file: string }) => {
      const id = await resolveAcceptanceId(ref);
      const input: { expectedVersion: number; groups: AcceptanceCheckGroup[] } = JSON.parse(
        await readFile(options.file, 'utf8'),
      );
      const client = await getTrpcClient();
      outputJson(await client.acceptance.regroupChecks.mutate({ ...input, id }));
    });

  acceptance
    .command('list')
    .description('List acceptances, newest first')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const items = await client.acceptance.list.query();

      if (options.json !== undefined) {
        outputJson(
          withUrls(items, await resolveUrlBuilder(client), (item: any) =>
            resourcePath.acceptance(item.id),
          ),
          typeof options.json === 'string' ? options.json : undefined,
        );
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
        outputJson(
          withUrl(bundle, await resolveUrlBuilder(client), resourcePath.acceptance(id)),
          typeof options.json === 'string' ? options.json : undefined,
        );
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
      "The user's review feedback — unresolved comments, region notes, attachments and rejection decisions",
    )
    .option('--actionable', 'Only standing feedback the next repair round must act on')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (idOrSubject: string, options: { actionable?: boolean; json?: boolean | string }) => {
        const id = await resolveAcceptanceId(idOrSubject);
        const client = await getTrpcClient();
        const [bundle, comments] = await Promise.all([
          client.acceptance.getBundle.query({ id }),
          client.acceptanceComment.list.query({ acceptanceId: id }),
        ]);

        const currentRoundIndex = bundle.rounds.at(-1)?.run.roundIndex ?? 0;

        interface FeedbackEntry {
          actionable: boolean;
          /**
           * Kept whole. Dropping `evidenceId`/`rect` here used to leave the
           * reader with a bare note and several plausible targets on the
           * screenshot — the location is the actionable half of a region.
           */
          annotations?: (ReviewAnnotationRegion & { region?: string })[];
          attachments?: AcceptanceAttachment[];
          category?: string;
          checkId?: string;
          checkSeq?: number;
          comment: string;
          commentId?: string;
          createdAt?: string;
          fileIds?: string[];
          kind: 'check' | 'group' | 'flow' | 'comment' | 'decision';
          page?: { locations: string[]; url: string };
          roundIndex: number;
          title?: string;
        }

        // `evidenceId` is opaque on its own — resolve it to the artifact name the
        // report used. An annotation can point at an older round's evidence, so
        // the timeline is folded in alongside the check's current evidence.
        interface EvidenceRow {
          description?: string | null;
          id?: string;
        }
        const evidenceLabels = new Map<string, string>();
        for (const check of bundle.checks) {
          const rows: EvidenceRow[] = [
            ...(check.evidence ?? []),
            ...(check.timeline ?? []).flatMap(
              (entry: { evidence?: EvidenceRow[] }) => entry.evidence ?? [],
            ),
          ];
          for (const row of rows) {
            if (row?.id && row.description) evidenceLabels.set(row.id, row.description);
          }
        }

        const entries: FeedbackEntry[] = [];
        const flowResultIds = new Set(
          (bundle.flows ?? []).flatMap((flow) =>
            flow.versions.flatMap((version) =>
              version.runs.flatMap((run) => run.attempts.map((attempt) => attempt.checkResultId)),
            ),
          ),
        );
        for (const check of bundle.checks) {
          for (const review of check.reviews) {
            if (review.action !== 'reject' || flowResultIds.has(review.id)) continue;
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
              annotations: review.annotations?.map((a: ReviewAnnotationRegion) => ({
                ...a,
                region: formatAnnotationRegion(a, evidenceLabels),
              })),
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
        for (const flow of bundle.flows ?? []) {
          for (const version of flow.versions) {
            for (const run of version.runs) {
              const latest = new Map(
                run.attempts.map((attempt) => [attempt.checkItemId, attempt.id]),
              );
              for (const attempt of run.attempts) {
                if (attempt.review !== 'rejected') continue;
                for (const evidence of attempt.evidence) {
                  if (evidence.description) evidenceLabels.set(evidence.id, evidence.description);
                }
                entries.push({
                  actionable:
                    version.id === flow.versions[0]?.id &&
                    run.id === version.runs[0]?.id &&
                    latest.get(attempt.checkItemId) === attempt.id,
                  annotations: attempt.reviewDetail?.annotations?.map((a) => ({
                    ...a,
                    region: formatAnnotationRegion(a, evidenceLabels),
                  })),
                  checkId: attempt.checkItemId,
                  comment: attempt.reviewComment ?? '',
                  createdAt: attempt.reviewDetail?.decidedAt,
                  fileIds: attempt.reviewDetail?.fileIds,
                  kind: 'flow',
                  roundIndex:
                    bundle.rounds.find((round) => round.run.id === run.verifyRunId)?.run
                      .roundIndex ?? 0,
                  title: `${version.nodes.find((node) => node.id === attempt.nodeId)?.title ?? ''} · #${attempt.sequence}`,
                });
              }
            }
          }
        }
        for (const round of bundle.rounds) {
          const { decisionDetail, userDecision } = round.run;
          const roundIndex = round.run.roundIndex ?? 0;
          if (userDecision === 'reject' && decisionDetail?.comment?.trim()) {
            entries.push({
              actionable: roundIndex >= currentRoundIndex,
              comment: decisionDetail.comment,
              createdAt: decisionDetail.decidedAt,
              kind: 'decision',
              roundIndex,
            });
          }
          for (const entry of round.run.decisionDetail?.groupFeedback ?? []) {
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
        entries.push(...collectCommentFeedback(comments.items, bundle.checks, evidenceLabels));
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
            entry.kind === 'decision'
              ? 'overall rejection'
              : entry.kind === 'comment'
                ? `comment ${entry.commentId} · ${entry.checkSeq === undefined ? 'overall' : `C${entry.checkSeq} ${truncate(entry.title ?? '', 60)}`}`
                : entry.kind === 'check'
                  ? `C${entry.checkSeq} ${truncate(entry.title ?? '', 60)}`
                  : entry.kind === 'flow'
                    ? `flow · ${entry.title}`
                    : `group · ${entry.category || 'overall'}`;
          console.log(`${marker} ${label} ${pc.dim(`(r${entry.roundIndex})`)}`);
          if (entry.comment) console.log(`    ${entry.comment}`);
          if (entry.page) {
            console.log(`    ${pc.dim('page:')} ${entry.page.url}`);
            for (const location of entry.page.locations)
              console.log(`      ${pc.dim(`└ ${location}`)}`);
          }
          for (const annotation of entry.annotations ?? []) {
            // The region is the anchor, and the anchor is metadata: lead with it,
            // dim the whole line, and hang the reviewer's own words under it, so
            // the readable half stays the comment.
            const note =
              annotation.comment && annotation.comment !== entry.comment
                ? annotation.comment
                : undefined;
            if (annotation.region) {
              console.log(`    ${pc.dim(`region: ${annotation.region}`)}`);
              if (note) console.log(`      ${pc.dim('└')} ${note}`);
            } else if (note) {
              console.log(`    ${pc.dim('region:')} ${note}`);
            }
            const disputed = formatDisputedChapter(annotation.disputes);
            if (disputed) console.log(`      ${pc.dim(`└ disputes ${disputed}`)}`);
          }
          if (entry.fileIds?.length)
            console.log(`    ${pc.dim(`attachments: ${entry.fileIds.join(', ')}`)}`);
          for (const attachment of entry.attachments ?? []) {
            if (attachment.url)
              console.log(`      ${attachment.name ?? attachment.id}: ${attachment.url}`);
          }
        }
      },
    );

  acceptance
    .command('preview <idOrSubject> <url>')
    .description(
      'Record where the latest round is deployed, so reviewers can comment on the live page (https or a loopback dev server)',
    )
    .option('--json [fields]', 'Output JSON')
    .action(async (idOrSubject: string, url: string, options: { json?: boolean | string }) => {
      const id = await resolveAcceptanceId(idOrSubject);
      const client = await getTrpcClient();
      const result = await client.acceptance.setPreviewUrl.mutate({ id, url });
      if (options.json !== undefined) {
        outputJson(
          withUrl(result, await resolveUrlBuilder(client), resourcePath.acceptance(id)),
          typeof options.json === 'string' ? options.json : undefined,
        );
        return;
      }
      console.log(`${pc.green('✓')} r${result.roundIndex} preview: ${result.previewUrl}`);
    });

  acceptance
    .command('link-pr <idOrSubject> <url>')
    .description(
      'Record that a pull request delivers this acceptance (works for PRs opened after the last round)',
    )
    .option('--title <text>', 'Pull request title, until the provider reports it')
    .option('--unlink', 'Remove the link instead')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        idOrSubject: string,
        url: string,
        options: { json?: boolean | string; title?: string; unlink?: boolean },
      ) => {
        const id = await resolveAcceptanceId(idOrSubject);
        const client = await getTrpcClient();

        if (options.unlink) {
          await client.acceptance.unlinkPullRequest.mutate({ id, url });
          if (options.json !== undefined) {
            outputJson(
              { unlinked: true, url },
              typeof options.json === 'string' ? options.json : undefined,
            );
            return;
          }
          console.log(`${pc.green('✓')} Unlinked ${url}`);
          return;
        }

        const linked = await client.acceptance.linkPullRequest.mutate({
          id,
          title: options.title,
          url,
        });
        if (options.json !== undefined) {
          outputJson(
            withUrl(linked, await resolveUrlBuilder(client), resourcePath.acceptance(id)),
            typeof options.json === 'string' ? options.json : undefined,
          );
          return;
        }
        console.log(
          `${pc.green('✓')} Linked ${linked.repoFullName}#${linked.number} to acceptance ${id}`,
        );
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
        outputJson(
          withUrl(result, await resolveUrlBuilder(client), resourcePath.acceptance(id)),
          typeof options.json === 'string' ? options.json : undefined,
        );
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
        outputJson(
          withUrl(result, await resolveUrlBuilder(client), resourcePath.acceptance(id)),
          typeof options.json === 'string' ? options.json : undefined,
        );
        return;
      }
      console.log(`${pc.red('✗')} Delivery rejected (${result.id}) — next round re-opens it`);
      const dispatch = result.repairDispatch;
      if (dispatch?.dispatched) {
        console.log(
          `${pc.green('↻')} Sent back to agent ${dispatch.agentId} in topic ${dispatch.topicId} (operation ${dispatch.operationId})`,
        );
      } else if (dispatch?.reason === 'failed') {
        console.log(
          `${pc.yellow('!')} Repair dispatch failed: ${dispatch.error ?? 'unknown error'}`,
        );
      } else if (dispatch?.reason === 'goal_coordinator') {
        console.log(pc.dim('Goal task — its coordinator starts the next attempt.'));
      } else {
        const why =
          dispatch?.reason === 'forbidden'
            ? 'Not allowed to run the source agent'
            : 'No source agent to send it back to';
        console.log(
          pc.dim(
            `${why} — hand the repair over with: lh acceptance feedback ${result.id} --actionable`,
          ),
        );
      }
    });

  // The canonical `lh acceptance install` + `run` / `plan` / `criterion` / `rubric`
  // trees hang off the first-class command only; the legacy `lh verify acceptance`
  // alias stays a thin decision surface (the rest keep their `lh verify …` aliases).
  if (options?.deprecated) return;
  attachAcceptanceRunCommands(acceptance);
  attachPlanCommands(acceptance);
  attachCriterionCommands(acceptance);
  attachRubricCommands(acceptance);
}
