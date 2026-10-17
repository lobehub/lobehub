import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { acceptanceSubjectTypes } from '@lobechat/const/verify';
import type { VerifyAgentPlanConfig, VerifyCheckItem } from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { resolveWorkspaceId } from '../../../api/workspace';
import { resolveServerUrl } from '../../../settings';
import { ensureAcceptanceDirIgnoredFor } from '../../../utils/acceptanceDir';
import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { assertReportLanguage, ingestLanguageFields, languageSummary } from '../language';
import {
  deriveReportVerdict,
  type EvidenceType,
  findIdenticalLatestRound,
  genericContextFromResult,
  interactionCostFromReportDir,
  metadataForReport,
  originFromEnv,
  parseSubjectRef,
  planFromResult,
  pullRequestFromBranch,
  pullRequestFromResult,
  reuseSourceCriteria,
  scenarioFromResult,
  screenProgrammaticTestChecks,
  subjectFromEnv,
  subjectFromResult,
  surfacesFromResult,
  toVerdict,
  type Verdict,
  visualizationMetadata,
} from '../utils';
import type { FailedReportEvidence } from './evidenceUpload';
import { storageQuotaRecovery, uploadReportEvidence } from './evidenceUpload';
import { ingestIntoPlanRound } from './planRound';

// ── ingest-report (aggregate convenience over the atomic commands) ──

export interface IngestReportOptions {
  acceptance?: string;
  /** Run every local check, including the report language, then stop before publishing. */
  dryRun?: boolean;
  goal?: string;
  json?: boolean | string;
  open?: boolean;
  operation?: string;
  requirement?: string;
  source?: string;
  subject?: string;
  title?: string;
}

export async function ingestReportAction(
  reportDir: string,
  options: IngestReportOptions,
): Promise<void> {
  const dir = path.resolve(reportDir);
  // The guarantee has to hold however the round got here — a project that never
  // ran `acceptance install`, or an agent that wrote the round by hand, still
  // must not leave evidence binaries untracked in someone's repo.
  ensureAcceptanceDirIgnoredFor(dir);
  const resultPath = path.join(dir, 'result.json');
  if (!existsSync(resultPath)) {
    log.error(`result.json not found in ${dir}`);
    process.exit(1);
  }

  let result: any;
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8'));
  } catch {
    log.error('result.json is not valid JSON');
    process.exit(1);
  }

  // Unit tests, type-checks and lint gates are preconditions of shipping, not
  // things a person accepts — a page full of them buries the checks that
  // actually needed a human eye. Screen them out of both the plan and the cases
  // before anything is published.
  const { droppedIds, droppedLabels } = screenProgrammaticTestChecks(result);
  const allCases: any[] = Array.isArray(result.cases) ? result.cases : [];
  // Freeze each case's id BEFORE filtering: the fallback id is position-based
  // (`case-N`), so dropping an earlier case would re-enumerate the survivors in
  // the ingest loop — pairing them with the wrong plan items and publishing
  // orphaned results into the immutable round.
  const casesWithIds = allCases.map((c, index) => ({
    case: c,
    checkItemId: String(c?.id ?? c?.checkItemId ?? `case-${index + 1}`),
  }));
  const cases = casesWithIds.filter(({ checkItemId }) => !droppedIds.has(checkItemId));
  // Every check was a gate: there is nothing here for a person to accept, and
  // publishing an empty round would just create a verdict-less page. Fail before
  // the first remote mutation, while the author can still fix the report.
  if (cases.length === 0 && allCases.length > 0) {
    log.error(
      'every check in this round is a programmatic gate (tests / type-check / lint) — nothing here needs a human decision.',
    );
    log.error(
      '  Verify what the delivery does, shows, or produces, and keep the gates as one line of report.md.',
    );
    process.exit(1);
  }
  // Validate every schemaless visualization before the first remote mutation.
  // An ingest that cannot render must not create or attach a partial immutable round.
  const caseMetadata = cases.map(({ case: item, checkItemId }) => {
    try {
      return visualizationMetadata(item);
    } catch (error) {
      throw new Error(
        `case ${checkItemId}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
  const summary = result.summary ?? {};
  const reportMdPath = path.join(dir, 'report.md');
  const content = existsSync(reportMdPath) ? readFileSync(reportMdPath, 'utf8') : undefined;

  // What this round is, said to the person who has to accept it, in their
  // language — the delivery's own note, not the verification write-up. It
  // posts into the discussion as a message from whoever ran the ingest, so a
  // reviewer reads it where the conversation already is rather than behind a
  // report link.
  const proposalMdPath = path.join(dir, 'proposal.md');
  const proposal = (
    existsSync(proposalMdPath)
      ? readFileSync(proposalMdPath, 'utf8')
      : typeof result.proposal === 'string'
        ? result.proposal
        : ''
  ).trim();

  // What kind of delivery this report verified (default: coding).
  const scenario = scenarioFromResult(result);

  // The scenario's context for the report's scope header. Coding lifts the
  // well-known top-level fields (branch / commit / surfaces / PR); every
  // other scenario passes result.json `context` through as its own bag.
  // `pullRequest` is hoisted: the success output (text and --json) prints
  // the PR link after the ingest, whatever the scenario resolved to.
  let context: Record<string, unknown> | undefined;
  let pullRequest: ReturnType<typeof pullRequestFromResult>;
  // Only a PR the report names is a delivery claim; the branch lookup below is
  // best-effort provenance and may find a long-lived branch's unrelated PR.
  let authoredPullRequest: ReturnType<typeof pullRequestFromResult>;
  if (scenario === 'coding') {
    const branch = typeof result.branch === 'string' ? result.branch : undefined;
    const surfaces = surfacesFromResult(result);
    // An authored PR wins; otherwise ask `gh` what the branch's PR is, so the
    // report links to it without the author having to remember the field.
    authoredPullRequest = pullRequestFromResult(result);
    pullRequest = authoredPullRequest ?? pullRequestFromBranch(branch);
    const contextEntries = Object.entries({
      branch,
      commit: typeof result.commit === 'string' ? result.commit : undefined,
      entry: typeof result.entry === 'string' ? result.entry : undefined,
      pullRequest,
      surfaces,
      testedAt: typeof result.createdAt === 'string' ? result.createdAt : undefined,
    }).filter(([, v]) => v !== undefined);
    context = contextEntries.length > 0 ? Object.fromEntries(contextEntries) : undefined;
  } else {
    context = genericContextFromResult(result);
  }

  // What the run set out to check, written before it ran. Paired with the
  // results by `id`, so the report can show a planned item that never ran.
  let plan: VerifyCheckItem[] | undefined = planFromResult(result, droppedIds);

  const goal = options.goal ?? (typeof result.focus === 'string' ? result.focus : undefined);
  const title = options.title ?? result.title;
  // The title is the run's identity in every list surface — an untitled
  // run renders as a placeholder forever, so say so before it ships.
  if (!title) {
    log.warn(
      'result.json has no "title" — the run will list as untitled; set result.title (or pass --title)',
    );
  }

  const requestedAcceptanceId = options.acceptance?.trim();
  if (requestedAcceptanceId && (options.subject || result.subject)) {
    log.error(
      'Choose one acceptance target: pass --acceptance <id>, or use --subject/result.json `subject`.',
    );
    process.exit(1);
  }

  // Explicit subject input wins, then result.json, then the authoring topic.
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
    const ref = subjectFromEnv();
    if (ref) subject = { ref };
    // Only the ambient topic may be folded onto its Task; an explicit subject stays exact.
    foldTaskRunTopic = Boolean(ref);
  }
  if (!requestedAcceptanceId && !subject) {
    subject = {
      ref: { subjectId: randomUUID(), subjectType: 'standalone' },
    };
  }
  const requirement = options.requirement ?? subject?.requirement;

  // The overall conclusion, rendered at the top of the report page. Read up
  // front so the duplicate check below compares what would land.
  const conclusion =
    typeof summary.conclusion === 'string'
      ? summary.conclusion
      : typeof summary.note === 'string'
        ? summary.note
        : undefined;

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
    // ID-based reads can cross scopes, but creating a run uses the CLI's scope.
    // Reject before any writes instead of leaving an unattachable run behind.
    const currentWorkspaceId = resolveWorkspaceId();
    const targetWorkspaceId = acceptance.workspaceId ?? undefined;
    if (currentWorkspaceId !== targetWorkspaceId) {
      const current = currentWorkspaceId ? `workspace "${currentWorkspaceId}"` : 'personal space';
      const target = targetWorkspaceId ? `workspace "${targetWorkspaceId}"` : 'personal space';
      const hint = targetWorkspaceId
        ? `Set LOBEHUB_WORKSPACE_ID=${targetWorkspaceId} for this command and retry.`
        : "Unset LOBEHUB_WORKSPACE_ID and run 'lh workspace use --personal', then retry.";
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
  const missingEvidence: { checkItemId: string; types: EvidenceType[] }[] = [];
  const publishedVerdicts: Verdict[] = [];
  for (const [index, { case: c, checkItemId }] of cases.entries()) {
    seenCheckItemIds.add(checkItemId);
    const verdict = toVerdict(c.result ?? c.status ?? c.verdict);
    const observation = c.keyObservation ?? c.observation ?? c.note;
    const checkInput = {
      checkItemId,
      checkItemIndex: index,
      checkItemTitle: c.name ?? c.case ?? c.title ?? checkItemId,
      metadata: caseMetadata[index],
      required: c.required ?? true,
      // The case's key observation is recorded as Toulmin evidence; a real
      // remediation hint (if the report provides one) goes to `suggestion`.
      // Absent → explicit `null`, so this immutable snapshot records the
      // absence instead of relying on upsert defaults.
      suggestion: typeof c.suggestion === 'string' ? c.suggestion : null,
      toulmin: typeof observation === 'string' ? { evidence: observation } : null,
      verdict,
      verifierType: 'agent' as const,
      verifyRunId: runId,
    };
    const checkResult = await client.verify.ingestResult.mutate(checkInput);
    const uploaded = await uploadReportEvidence(client, {
      checkResultId: checkResult.id,
      dir,
      evidence: c.evidence,
    });
    evidenceCount += uploaded.count;
    inlined += uploaded.inlined;
    failedEvidence.push(...uploaded.failedEvidence.map((failure) => ({ ...failure, checkItemId })));
    const config = plan?.find((item) => item.id === checkItemId)?.verifierConfig as
      VerifyAgentPlanConfig | undefined;
    const required = config?.requiredEvidence;
    const gaps = [...new Set(required?.map((spec) => spec.type) ?? [])].filter(
      (type) => !uploaded.types.has(type),
    );
    const publishedVerdict = gaps.length > 0 && verdict === 'passed' ? 'uncertain' : verdict;
    publishedVerdicts.push(publishedVerdict);
    if (gaps.length > 0) {
      missingEvidence.push({ checkItemId, types: gaps });
      const limitation = `Required evidence not published: ${gaps.join(', ')}.`;
      log.warn(`${checkItemId}: ${limitation}`);
      await client.verify.ingestResult.mutate({
        ...checkInput,
        toulmin: { ...checkInput.toulmin, limitation },
        verdict: publishedVerdict,
      });
    }
  }

  const unexecuted = plan?.filter((item) => !seenCheckItemIds.has(item.id)) ?? [];
  for (const item of unexecuted) {
    const config = item.verifierConfig as VerifyAgentPlanConfig;
    const types = [...new Set(config.requiredEvidence?.map((spec) => spec.type) ?? [])];
    if (types.length === 0) continue;
    missingEvidence.push({ checkItemId: item.id, types });
    // Count the gap without inventing an execution result for an unexecuted check.
    publishedVerdicts.push('uncertain');
    log.warn(`${item.id}: not executed; required evidence not published: ${types.join(', ')}.`);
  }

  // 3. Write the report. `summary` is the overall conclusion (read above);
  //    `content` is the full markdown detail.
  // A 0-100 quality score lands on overallConfidence (0-1); the report page
  // surfaces it as the `score` stat.
  const score =
    typeof summary.score === 'number' ? Math.max(0, Math.min(1, summary.score / 100)) : undefined;
  // The authored counts describe the report the author wrote. Once a
  // programmatic-test check is screened out they no longer match what was
  // published, so recount the landed cases and unexecuted evidence gaps — a
  // stats block that disagrees with the visible check list is worse than no stats.
  const recount = cases.length !== allCases.length || missingEvidence.length > 0;
  const counted = (verdict: Verdict) => publishedVerdicts.filter((v) => v === verdict).length;
  const derivedVerdict = deriveReportVerdict(publishedVerdicts.map((verdict) => ({ verdict })));
  const reportVerdict =
    summary.verdict && cases.length === allCases.length
      ? toVerdict(summary.verdict)
      : derivedVerdict;
  await client.verify.upsertReport.mutate({
    content,
    failedChecks: recount ? counted('failed') : summary.failed,
    overallConfidence: score,
    passedChecks: recount ? counted('passed') : summary.passed,
    summary: conclusion,
    totalChecks: recount ? publishedVerdicts.length : (summary.total ?? cases.length),
    uncertainChecks: recount
      ? counted('uncertain') || undefined
      : (summary.blocked ?? 0) + (summary.uncertain ?? 0) || undefined,
    // Missing evidence cannot be overridden by an authored "passed" summary.
    // Keep a real failure rather than hiding it behind an evidence warning.
    verdict:
      missingEvidence.length > 0
        ? reportVerdict === 'failed' || derivedVerdict === 'failed'
          ? 'failed'
          : 'uncertain'
        : reportVerdict,
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

  if (options.json !== undefined) {
    outputJson(
      {
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
      },
      typeof options.json === 'string' ? options.json : undefined,
    );
    return;
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
  if (options.open || partial) {
    // The acceptance page is the only report page — an old /verify link only
    // redirects here. `?r=<roundIndex>` is this round's fixed snapshot.
    console.log(`${pc.bold('open acceptance')}: ${acceptanceUrl}`);
    if (roundUrl) {
      console.log(`${pc.bold('round snapshot')}: ${roundUrl}`);
    }
  }
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
    .option('--open', 'Print the in-app URL to open the report')
    .option(
      '--dry-run',
      'Validate the report (including its language) without publishing; works on a plan-only result.json',
    )
    .option('--json [fields]', 'Output JSON');
}
