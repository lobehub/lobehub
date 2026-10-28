import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { acceptanceSubjectTypes } from '@lobechat/const/verify';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { PERSONAL_SCOPE_ENV_VALUE, resolveWorkspaceId } from '../../../api/workspace';
import { resolveServerUrl } from '../../../settings';
import { ensureAcceptanceDirIgnoredFor } from '../../../utils/acceptanceDir';
import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { assertReportLanguage, ingestLanguageFields, languageSummary } from '../language';
import { projectEnsureInput, resolveAcceptanceProject, warnIfFiledElsewhere } from '../project';
import {
  type AcceptanceSubjectRef,
  type EvidenceType,
  findIdenticalLatestRound,
  interactionCostFromReportDir,
  metadataForReport,
  originFromEnv,
  parseSubjectRef,
  reuseSourceCriteria,
  subjectFromEnv,
  subjectFromResult,
  type Verdict,
} from '../utils';
import type { FailedReportEvidence } from './evidenceUpload';
import { storageQuotaRecovery, uploadReportEvidence } from './evidenceUpload';
import { ingestIntoPlanRound } from './planRound';
import {
  caseResult,
  missingEvidenceLimitation,
  publishedVerdictFor,
  readReportRound,
  type ReportRound,
  ReportRoundError,
  requiredEvidenceGaps,
  settleReport,
  unexecutedEvidenceGaps,
} from './reportRound';

// ── ingest-report (aggregate convenience over the atomic commands) ──

export interface IngestReportOptions {
  acceptance?: string;
  /** Run every local check, including the report language, then stop before publishing. */
  dryRun?: boolean;
  /** Local publication's stable subject, used only without an authored subject. Not a CLI flag. */
  fallbackSubject?: AcceptanceSubjectRef;
  goal?: string;
  json?: boolean | string;
  open?: boolean;
  operation?: string;
  project?: string;
  /**
   * Programmatic callers (`lh acceptance publish`): print nothing on success and
   * return the summary `--json` would print. Not a command-line flag.
   */
  quiet?: boolean;
  requirement?: string;
  source?: string;
  subject?: string;
  title?: string;
}

/** What a published authored round reports back (`--json`). */
export type IngestReportSummary = Exclude<Awaited<ReturnType<typeof ingestReportAction>>, void>;

export async function ingestReportAction(reportDir: string, options: IngestReportOptions) {
  const dir = path.resolve(reportDir);
  // The guarantee has to hold however the round got here — a project that never
  // ran `acceptance install`, or an agent that wrote the round by hand, still
  // must not leave evidence binaries untracked in someone's repo.
  ensureAcceptanceDirIgnoredFor(dir);
  let round: ReportRound;
  try {
    round = readReportRound(dir, { goal: options.goal, title: options.title });
  } catch (error) {
    if (!(error instanceof ReportRoundError)) throw error;
    for (const line of error.lines) log.error(line);
    process.exit(1);
  }
  const {
    allCases,
    authoredPullRequest,
    caseMetadata,
    cases,
    conclusion,
    content,
    context,
    droppedLabels,
    goal,
    proposal,
    pullRequest,
    result,
    scenario,
    summary,
    title,
  } = round;
  let plan = round.plan;

  const requestedAcceptanceId = options.acceptance?.trim();
  if (requestedAcceptanceId && options.subject) {
    log.error('Choose one acceptance target: pass --acceptance <id>, or use --subject.');
    process.exit(1);
  }

  // Explicit subject input wins, then result.json, then the local publisher's
  // stable identity (if any), then the authoring topic.
  // An external repository has none of those, so create a first-class
  // standalone subject instead of making the caller manufacture a Task ID.
  let subject = subjectFromResult(result);
  let foldTaskRunTopic = false;
  if (!requestedAcceptanceId && options.subject) {
    const ref = parseSubjectRef(options.subject);
    if (!ref) {
      log.error(
        `--subject must be one of ${acceptanceSubjectTypes.map((t) => `${t}:<id>`).join(' | ')}`,
      );
      process.exit(1);
    }
    subject = { ref, requirement: subject?.requirement };
  } else if (!requestedAcceptanceId && result.subject && !subject) {
    log.error('result.json `subject` is malformed (expected "type:id" or {type,id})');
    process.exit(1);
  } else if (!requestedAcceptanceId && !subject) {
    const ref = options.fallbackSubject ?? subjectFromEnv();
    if (ref) subject = { ref };
    // Only the ambient topic may be folded onto its Task; an explicit subject stays exact.
    foldTaskRunTopic = !options.fallbackSubject && Boolean(ref);
  }
  if (!requestedAcceptanceId && !subject) {
    subject = {
      ref: { subjectId: randomUUID(), subjectType: 'standalone' },
    };
  }
  const requirement = options.requirement ?? subject?.requirement;

  const client = await getTrpcClient();
  // Before the first remote mutation: a round in the wrong language cannot be
  // fixed in place, only replaced by another immutable round.
  const language = await assertReportLanguage(
    client,
    ingestLanguageFields({
      cases,
      conclusion,
      goal,
      plan,
      proposal,
      report: content,
      requirement,
      title,
    }),
  );
  // The repository the report was written in names the project; a report in a
  // scratch directory falls back to where the command runs.
  const project = await resolveAcceptanceProject(client, {
    flag: options.project,
    startDirs: [dir, process.cwd()],
  });
  if (options.dryRun) {
    const checked =
      language.status === 'enforced'
        ? `report language ${language.locale} ✓`
        : language.status === 'unchecked'
          ? `report language ${language.locale} (not script-checked)`
          : 'report language not set';
    if (options.json !== undefined) {
      outputJson(
        {
          cases: cases.length,
          dryRun: true,
          language: languageSummary(language),
          planItems: plan?.length ?? 0,
          projectId: project?.id ?? null,
        },
        typeof options.json === 'string' ? options.json : undefined,
      );
      return;
    }
    console.log(
      `${pc.green('✓ Dry run passed')} — ${cases.length} case(s), ${plan?.length ?? 0} plan item(s), ${checked}. Nothing was published.`,
    );
    return;
  }
  // An Agent Run that already owns a round (a Task's plan round) publishes into
  // it: the operation id is unique per run, and a second round would be judged
  // apart from the verifier's. Only a confirmed plan marks such a round — an
  // earlier authored ingest under this operation left a run with no confirmed
  // plan, and folding a retry into it would drop the authored verdicts and report.
  const operationState = options.operation
    ? await client.verify.getVerifyState.query({ operationId: options.operation })
    : null;
  if (operationState?.verifyPlanConfirmedAt) {
    if (options.acceptance || options.subject) {
      log.error(
        `Operation ${options.operation} already has a verification round; drop --acceptance/--subject.`,
      );
      process.exit(1);
    }
    if (options.project) {
      log.warn('--project is ignored: a Task plan round is filed with its Task.');
    }
    return ingestIntoPlanRound(client, {
      authoredPlan: plan,
      caseMetadata,
      cases,
      dir,
      droppedLabels,
      json: options.json,
      operationId: options.operation!,
      proposal,
      pullRequest: authoredPullRequest,
      reportContent: content,
      state: operationState,
    });
  }
  let acceptance;
  let bundle;
  if (requestedAcceptanceId) {
    bundle = await client.acceptance.getBundle.query({ id: requestedAcceptanceId });
    acceptance = bundle.acceptance;
    // A round's authored `subject` may ride along with the acceptance that
    // already holds it (`lh acceptance publish` appends later rounds by id);
    // one naming another subject is a conflicting target, not a hint.
    if (
      result.subject &&
      (subject?.ref.subjectType !== acceptance.subjectType ||
        subject.ref.subjectId !== acceptance.subjectId)
    ) {
      log.error(
        `result.json \`subject\` does not match acceptance "${acceptance.id}" (${acceptance.subjectType}:${acceptance.subjectId}). Drop --acceptance, or the subject.`,
      );
      process.exit(1);
    }
    // ID-based reads can cross scopes, but creating a run uses the CLI's scope.
    // Reject before any writes instead of leaving an unattachable run behind.
    const currentWorkspaceId = resolveWorkspaceId();
    const targetWorkspaceId = acceptance.workspaceId ?? undefined;
    if (currentWorkspaceId !== targetWorkspaceId) {
      const current = currentWorkspaceId ? `workspace "${currentWorkspaceId}"` : 'personal space';
      const target = targetWorkspaceId ? `workspace "${targetWorkspaceId}"` : 'personal space';
      const hint = targetWorkspaceId
        ? `Set LOBEHUB_WORKSPACE_ID=${targetWorkspaceId} for this command and retry.`
        : `Set LOBEHUB_WORKSPACE_ID=${PERSONAL_SCOPE_ENV_VALUE} for this command and retry.`;
      throw new Error(
        `Acceptance "${acceptance.id}" belongs to ${target}, but the CLI is using ${current}. ${hint} No run was created.`,
      );
    }
    if (targetWorkspaceId) {
      // Revoked membership can make the server fall back to personal scope
      // even when the locally selected workspace still matches the target.
      const workspace = await client.workspace.getById.query();
      if (workspace?.id !== targetWorkspaceId) {
        throw new Error(
          `The server did not resolve workspace "${targetWorkspaceId}" for this account. Check your access with 'lh workspace list' before retrying. No run was created.`,
        );
      }
    }
    subject = {
      ref: {
        subjectId: acceptance.subjectId,
        subjectType: acceptance.subjectType,
      },
    };
  } else {
    acceptance = await client.acceptance.ensure.mutate({
      ...projectEnsureInput(project),
      requirement,
      subjectId: subject!.ref.subjectId,
      subjectType: subject!.ref.subjectType,
      ...(foldTaskRunTopic ? { foldTaskRunTopic } : {}),
      ...(subject!.ref.subjectType === 'standalone' && (title || goal)
        ? { title: title || goal }
        : {}),
    });
    // The server may fold the subject (a Task's run topic lands on the Task).
    subject = {
      ...subject!,
      ref: { subjectId: acceptance.subjectId, subjectType: acceptance.subjectType },
    };
    // A subject's acceptance may already hold rounds; this one has to line up
    // with them exactly as an explicit `--acceptance` round does.
    bundle = await client.acceptance.getBundle.query({ id: acceptance.id });
  }
  plan = reuseSourceCriteria(plan, bundle?.checks);

  const identicalRound = findIdenticalLatestRound(bundle?.rounds, {
    plan,
    report: { content, summary: conclusion },
  });
  if (identicalRound) {
    log.error(
      `This report is identical to round ${identicalRound.roundIndex ?? '?'} (${identicalRound.id}) — nothing new to publish.`,
    );
    log.error(
      `  To replace that round, delete it first: lh acceptance run delete ${identicalRound.id}`,
    );
    process.exit(1);
  }
  warnIfFiledElsewhere(project, acceptance);
  // The in-app conversation that ran this harness, if any (env-supplied).
  // Strictly the authoring conversation. `--operation` names the Agent Run
  // under test and is passed to `createRun` below — a different relation.
  const origin = originFromEnv();
  // A UI run that traced its actions prices them here, with the platform's own
  // counting logic; a run without a trace just has no interaction cost.
  const tracedCost = interactionCostFromReportDir(dir, result);
  if (tracedCost) result.interactionCost = tracedCost;
  const newRunMetadata = metadataForReport(result, undefined, origin);

  if (acceptance.status === 'accepted' || acceptance.status === 'closed') {
    log.error(
      `Acceptance is already ${acceptance.status}. Reopen it before publishing another round.`,
    );
    process.exit(1);
  }

  // Every ingest is an immutable verification snapshot. A repair or
  // re-verification is another round on the same acceptance, unless the
  // acceptance still holds a draft round: the server folds this run into it.
  if (operationState) {
    log.error(
      `Operation ${options.operation} already has an authored round (${operationState.verifyRunId}); a round is immutable.`,
    );
    log.error(
      '  Retry only failed evidence with its retryArgs, or publish a new round without --operation.',
    );
    process.exit(1);
  }
  // An acceptance named by id skips `ensure`, so apply its precedence here: a
  // `--project` files an ungrouped acceptance, while the repository's default
  // only fills a standalone one — a task or conversation defers to its own
  // project, which the server files when the round attaches. Placed after
  // every rejection guard so a round that publishes nothing writes nothing.
  if (
    requestedAcceptanceId &&
    project &&
    !acceptance.projectId &&
    (project.source === 'flag' || acceptance.subjectType === 'standalone')
  ) {
    await client.acceptance.setProject.mutate({ id: acceptance.id, projectId: project.id });
    acceptance = { ...acceptance, projectId: project.id };
  }
  const run = await client.verify.createRun.mutate({
    context,
    goal,
    metadata: newRunMetadata,
    operationId: options.operation,
    plan,
    scenario,
    source: options.source as any,
    title,
  });
  // 1c. Chain the session onto its subject's acceptance as the next round
  //     BEFORE the report lands, so the report-time status rollup already
  //     sees the aggregate. Results and the report go to the round the server
  //     returns, which is the draft round when this run was folded into one.
  const acceptanceId = acceptance.id;
  const attached = await client.acceptance.attachRun.mutate({ acceptanceId, verifyRunId: run.id });
  // Folding preserves the draft's checks and their evidence requirements.
  plan = attached?.plan ?? plan;
  const runId = attached?.id ?? run.id;
  if (runId !== run.id)
    console.log(pc.dim(`Folded into the acceptance's draft round ${attached.roundIndex ?? ''}`));
  // The chained round's index — `?r=<roundIndex>` on the acceptance URL
  // deep-links this round's report as the fixed snapshot view.
  const roundIndex = attached?.roundIndex ?? null;
  // A `supersedes` entry that names no check of this acceptance folds nothing:
  // the old row would stay on the page as if never replaced. An older server
  // does not report these, so treat the field as optional.
  const unresolvedSupersedes: string[] = attached?.unresolvedSupersedes ?? [];
  if (unresolvedSupersedes.length > 0) {
    log.warn(
      `supersedes names no check of this acceptance, so nothing was replaced: ${unresolvedSupersedes.join(', ')}. Name it by a plan item id from an earlier round or a check id from \`lh acceptance view --json\`.`,
    );
  }
  const acceptanceUrl = new URL(
    `/acceptance/${encodeURIComponent(acceptanceId)}`,
    resolveServerUrl(),
  ).toString();
  const roundUrl =
    roundIndex === null ? null : `${acceptanceUrl}?r=${encodeURIComponent(String(roundIndex))}`;

  // 2. Ingest each case as a check result + its evidence. `checkItemId` is
  //    the stable key within this immutable run.
  const seenCheckItemIds = new Set<string>();
  let evidenceCount = 0;
  let inlined = 0;
  const failedEvidence: (FailedReportEvidence & { checkItemId: string })[] = [];
  // What landed, by authored position: a caller holding its own copy of the
  // round (`lh acceptance publish`) maps its artifacts onto these by identity.
  const publishedEvidence: { checkItemId: string; evidenceId: string; position: number }[] = [];
  const missingEvidence: { checkItemId: string; types: EvidenceType[] }[] = [];
  const publishedVerdicts: Verdict[] = [];
  for (const [index, { case: c, checkItemId }] of cases.entries()) {
    seenCheckItemIds.add(checkItemId);
    const checkInput = {
      ...caseResult(c, checkItemId, index, caseMetadata[index]),
      verifierType: 'agent' as const,
      verifyRunId: runId,
    };
    const { verdict } = checkInput;
    const checkResult = await client.verify.ingestResult.mutate(checkInput);
    const uploaded = await uploadReportEvidence(client, {
      checkResultId: checkResult.id,
      dir,
      evidence: c.evidence,
    });
    evidenceCount += uploaded.count;
    inlined += uploaded.inlined;
    failedEvidence.push(...uploaded.failedEvidence.map((failure) => ({ ...failure, checkItemId })));
    publishedEvidence.push(...uploaded.published.map((item) => ({ ...item, checkItemId })));
    const { executionGaps, gaps } = requiredEvidenceGaps(plan, checkItemId, uploaded.coverage);
    const publishedVerdict = publishedVerdictFor(verdict, gaps);
    publishedVerdicts.push(publishedVerdict);
    if (gaps.length > 0) {
      missingEvidence.push({ checkItemId, types: gaps });
      const limitation = missingEvidenceLimitation(gaps, executionGaps);
      log.warn(`${checkItemId}: ${limitation}`);
      await client.verify.ingestResult.mutate({
        ...checkInput,
        toulmin: { ...checkInput.toulmin, limitation },
        verdict: publishedVerdict,
      });
    }
  }

  const unexecuted = plan?.filter((item) => !seenCheckItemIds.has(item.id)) ?? [];
  for (const { item, types } of unexecutedEvidenceGaps(plan, seenCheckItemIds)) {
    missingEvidence.push({ checkItemId: item.id, types });
    // Count the gap without inventing an execution result for an unexecuted check.
    publishedVerdicts.push('uncertain');
    log.warn(`${item.id}: not executed; required evidence not published: ${types.join(', ')}.`);
  }

  // 3. Write the report. `summary` is the overall conclusion (read above);
  //    `content` is the full markdown detail.
  await client.verify.upsertReport.mutate({
    ...settleReport({
      allCasesCount: allCases.length,
      casesCount: cases.length,
      conclusion,
      content,
      missingEvidenceCount: missingEvidence.length,
      publishedVerdicts,
      summary,
    }),
    verifyRunId: runId,
  });

  // 4. Post the round's note. It renders as part of the round rather than as
  //    another message, so the discussion reads "<agent> shipped round N"
  //    followed by what it says. Last, and never fatal: the round itself is
  //    the deliverable, and a failed comment must not strand a published round
  //    behind an aborted ingest.
  let proposalPosted = false;
  if (proposal) {
    try {
      await client.acceptanceComment.create.mutate({
        acceptanceId,
        // Signed by the agent that produced the round, not by whoever's
        // credentials carried the ingest. Absent outside an agent run, and
        // then it falls back to the account.
        authorAgentId: process.env.LOBEHUB_AGENT_ID || undefined,
        // Derived from the round, so re-ingesting the same round edits nothing
        // and duplicates nothing.
        clientId: `proposal:${runId}`,
        content: proposal,
        contextRunId: runId,
        kind: 'proposal',
      });
      proposalPosted = true;
    } catch (e) {
      log.warn(`proposal not posted to the discussion: ${String(e)}`);
    }
  }

  // 5. Link the PR to the acceptance itself. The round's context is a
  //    snapshot of this ingest; the acceptance is what the PR delivers, and
  //    the page reads its PRs from there. Only the report's own PR is linked:
  //    a branch-inferred one stays round provenance. Never fatal: an older
  //    server lacks the procedure, and the round itself is the deliverable.
  if (authoredPullRequest?.url) {
    try {
      await client.acceptance.linkPullRequest.mutate({
        id: acceptanceId,
        title:
          typeof authoredPullRequest.title === 'string' ? authoredPullRequest.title : undefined,
        url: String(authoredPullRequest.url),
      });
    } catch (e) {
      log.warn(`pull request not linked to the acceptance: ${String(e)}`);
    }
  }

  // A case with no matching plan item means the run checked something it
  // never planned — worth saying out loud, but not a failure. Only
  // meaningful against a plan that actually names something: with no plan
  // (or a cleared one) every case is trivially "unplanned", which is noise.
  const unplanned = plan?.length
    ? [...seenCheckItemIds].filter((id) => !plan.some((item) => item.id === id))
    : [];

  const recovery = failedEvidence.some((failure) => failure.reason === 'storage_quota')
    ? await storageQuotaRecovery(client)
    : undefined;
  const partial = failedEvidence.length > 0 || missingEvidence.length > 0;
  if (partial) {
    process.exitCode = 1;
    log.warn(
      'Report saved, but evidence publication is incomplete. Keep the local artifacts; retry only the missing evidence, not the whole ingest. Supplementing evidence does not change recorded verdicts.',
    );
    if (missingEvidence.some(({ checkItemId }) => !seenCheckItemIds.has(checkItemId))) {
      log.warn(
        'Unexecuted checks have no result to attach evidence to. Execute them and publish a new round on the same acceptance; do not re-ingest this unchanged report.',
      );
    }
    if (recovery) log.warn(recovery.message);
  }

  const published = {
    acceptanceId,
    acceptanceUrl,
    cases: cases.length,
    droppedProgrammaticChecks: droppedLabels,
    evidence: evidenceCount,
    failedEvidence,
    inlined,
    missingEvidence,
    origin,
    planItems: plan?.length ?? 0,
    proposalPosted,
    publicationStatus: partial ? 'partial' : 'complete',
    publishedEvidence,
    pullRequest,
    recovery,
    roundIndex,
    roundUrl,
    scenario,
    subject: subject!.ref,
    unexecuted: unexecuted.map((item) => item.id),
    unplanned,
    unresolvedSupersedes,
    verifyRunId: runId,
  };
  if (options.quiet) return published;
  if (options.json !== undefined) {
    outputJson(published, typeof options.json === 'string' ? options.json : undefined);
    return published;
  }

  console.log(
    `${partial ? pc.yellow('⚠ Partially published') : pc.green('✓ Ingested')} ${pc.bold(String(cases.length))} case(s), ${pc.bold(String(evidenceCount))} evidence artifact(s)` +
      `${inlined > 0 ? `, ${pc.bold(String(inlined))} inline` : ''}` +
      `${droppedLabels.length > 0 ? pc.yellow(` — ${droppedLabels.length} programmatic-test check(s) dropped`) : ''}`,
  );
  for (const failure of failedEvidence) {
    console.log(`${pc.yellow('retry (POSIX shell)')}: ${failure.retryCommand}`);
    console.log(
      `${pc.dim('retryArgs (lh, shell disabled)')}: ${JSON.stringify(failure.retryArgs)}`,
    );
  }
  if (plan?.length) {
    console.log(
      `${pc.bold('plan')}: ${plan.length} item(s)` +
        `${unexecuted.length > 0 ? pc.yellow(` — ${unexecuted.length} planned but not executed`) : ''}` +
        `${unplanned.length > 0 ? pc.dim(` — ${unplanned.length} unplanned case(s)`) : ''}`,
    );
  }
  if (proposalPosted) console.log(`${pc.bold('proposal')}: posted to the discussion`);
  if (pullRequest?.url) console.log(`${pc.bold('pr')}: ${pullRequest.url}`);
  if (origin?.topicId) console.log(`${pc.bold('origin topic')}: ${origin.topicId}`);
  console.log(`${pc.bold('verifyRunId')}: ${runId} ${pc.dim('(immutable snapshot)')}`);
  const subjectLabel =
    subject!.ref.subjectType === 'standalone'
      ? 'standalone'
      : `${subject!.ref.subjectType}:${subject!.ref.subjectId}`;
  console.log(`${pc.bold('acceptance')}: ${acceptanceId} ${pc.dim(`(${subjectLabel})`)}`);
  if (project && acceptance.projectId === project.id) {
    console.log(`${pc.bold('project')}: ${project.name}`);
  }
  if (options.open || partial) {
    // The acceptance page is the only report page — an old /verify link only
    // redirects here. `?r=<roundIndex>` is this round's fixed snapshot.
    console.log(`${pc.bold('open acceptance')}: ${acceptanceUrl}`);
    if (roundUrl) {
      console.log(`${pc.bold('round snapshot')}: ${roundUrl}`);
    }
  }
  return published;
}

export function withIngestReportOptions(cmd: Command): Command {
  return cmd
    .option('--source <source>', 'agent | agent-testing', 'agent-testing')
    .option(
      '--operation <id>',
      "Agent Run under test; a run that already owns a round (a Task's plan round) is published into",
    )
    .option('--acceptance <id>', 'Append this round to an existing acceptance')
    .option('--title <title>', 'Override the session title')
    .option('--goal <goal>', 'The goal/task being verified')
    .option(
      '--subject <type:id>',
      'Attach to a task/topic/document (defaults to the current topic; otherwise standalone)',
    )
    .option(
      '--requirement <text>',
      'Acceptance requirement recorded when the aggregate is first created',
    )
    .option(
      '--project <ref>',
      "File an ungrouped acceptance under a project (id, slug or identifier such as LOBE), overriding the subject's own; otherwise the subject's project, then the one in .agents/acceptance/config.json",
    )
    .option('--open', 'Print the in-app URL to open the report')
    .option(
      '--dry-run',
      'Validate the report (including its language) without publishing; works on a plan-only result.json',
    )
    .option('--json [fields]', 'Output JSON');
}
