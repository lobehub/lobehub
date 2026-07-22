import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { acceptanceSubjectTypes } from '@lobechat/const/verify';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import type { IgnoreResult, LinkResult } from '../utils/skillWiring';
import { ensureSkillIgnored, linkHarnessSkills } from '../utils/skillWiring';
import { uploadLocalFile } from '../utils/uploadLocalFile';
import {
  type Decision,
  DECISIONS,
  deriveReportVerdict,
  evidenceTypeForFile,
  genericContextFromResult,
  inlineTextEvidenceForFile,
  metadataForReport,
  originFromEnv,
  parseSubjectRef,
  planFromResult,
  printResults,
  pullRequestFromBranch,
  pullRequestFromResult,
  reportEvidence,
  scenarioFromResult,
  subjectFromEnv,
  subjectFromResult,
  surfacesFromResult,
  toVerdict,
} from './verifyHelpers';

// ── Actions ────────────────────────────────────────────────
//
// One implementation per command, shared by the canonical `lh acceptance run …`
// tree and the deprecated `lh verify …` aliases. Both wire the same function, so
// the two spellings never drift while the aliases live out their deprecation.

// ── install ──

interface InstallOptions {
  dir?: string;
  force?: boolean;
  gitignore?: boolean;
  json?: boolean | string;
  skill: string;
}

async function installAction(options: InstallOptions): Promise<void> {
  const client = await getTrpcClient();
  // Pulled live from the server's deployed builtin-skills — always the latest.
  const bundle = await client.verify.getSkillBundle.query({ identifier: options.skill });

  // The acceptance skeleton lands under `.agents/skills/<id>` — the harness dir
  // the project's own `.agents/acceptance/` adapter sits beside. Invariant: this
  // is a materialized artifact, re-installed to update, never hand-edited.
  const baseDir = options.dir ? path.resolve(options.dir) : process.cwd();
  const skillDir = path.join(baseDir, '.agents', 'skills', bundle.identifier);

  // path → content for SKILL.md plus every resource file.
  const entries: [string, string][] = [
    ['SKILL.md', bundle.content],
    ...Object.entries(bundle.files),
  ];

  const written: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of entries) {
    const dest = path.join(skillDir, rel);
    if (existsSync(dest) && !options.force) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content, 'utf8');
    written.push(rel);
  }

  const link = linkHarnessSkills(baseDir, bundle.identifier);
  const ignored =
    options.gitignore === false
      ? []
      : ensureSkillIgnored(baseDir, bundle.identifier, link.kind === 'linked');

  const result = { dir: skillDir, ignored, link, skill: bundle.identifier, skipped, written };
  if (options.json !== undefined) {
    outputJson(result, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(
    `${pc.green('✓')} ${pc.bold(bundle.name)} skill → ${pc.dim(path.relative(process.cwd(), skillDir) || skillDir)}`,
  );
  console.log(`  ${written.length} written${skipped.length ? `, ${skipped.length} skipped` : ''}`);
  if (skipped.length > 0) console.log(pc.dim(`  (skipped existing — pass --force to overwrite)`));
  printWiring(link, ignored);
}

function printWiring(link: LinkResult, ignored: IgnoreResult[]): void {
  const arrow = pc.dim('  ↳');
  switch (link.kind) {
    case 'linked':
    case 'linked-single': {
      console.log(`${arrow} linked ${link.link} → ${pc.dim(link.target)}`);
      break;
    }
    case 'already': {
      console.log(`${arrow} ${pc.dim(`${link.link} already linked`)}`);
      break;
    }
    case 'skipped': {
      console.log(`${arrow} ${pc.yellow(`skipped ${link.link}: ${link.reason}`)}`);
      break;
    }
    default: {
      break;
    }
  }

  for (const entry of ignored) {
    if (entry.kind !== 'added') continue;
    console.log(
      `${arrow} ignored ${entry.entry} in ${pc.dim(path.relative(process.cwd(), entry.file))}`,
    );
  }
}

// ── run ──

interface RunCreateOptions {
  goal?: string;
  json?: boolean | string;
  operation?: string;
  source?: string;
  title?: string;
}

async function runCreateAction(options: RunCreateOptions): Promise<void> {
  const client = await getTrpcClient();
  const created = await client.verify.createRun.mutate({
    goal: options.goal,
    operationId: options.operation,
    source: options.source as any,
    title: options.title,
  });
  if (options.json !== undefined) {
    outputJson(created, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Created run ${pc.bold(created.id)}`);
}

async function runListAction(options: { json?: boolean | string }): Promise<void> {
  const client = await getTrpcClient();
  const runs = await client.verify.listRuns.query();
  if (options.json !== undefined) {
    outputJson(runs, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (runs.length === 0) return void console.log('No runs found.');
  printTable(
    runs.map((r: any) => [
      r.id,
      truncate(r.title || '', 40),
      r.source,
      r.status ?? '',
      r.operationId ? 'agent' : 'standalone',
      r.createdAt ? timeAgo(r.createdAt) : '',
    ]),
    ['ID', 'TITLE', 'SOURCE', 'STATUS', 'KIND', 'CREATED'],
  );
}

async function runGetAction(runId: string, options: { json?: boolean | string }): Promise<void> {
  const client = await getTrpcClient();
  const item = await client.verify.getRun.query({ verifyRunId: runId });
  if (options.json !== undefined) {
    outputJson(item, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (!item) return void console.log('Run not found.');
  console.log(JSON.stringify(item, null, 2));
}

async function runDeleteAction(
  runId: string,
  options: { json?: boolean | string; yes?: boolean },
): Promise<void> {
  const client = await getTrpcClient();
  if (!options.yes) {
    const ok = await confirm(
      `Delete run ${pc.bold(runId)} and all its results, evidence and report? This cannot be undone.`,
    );
    if (!ok) return void console.log('Aborted.');
  }
  const result = await client.verify.deleteRun.mutate({ verifyRunId: runId });
  if (options.json !== undefined) {
    outputJson(result, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Deleted run ${pc.bold(result.id)}`);
}

// ── result ──

interface ResultIngestOptions {
  check: string;
  confidence?: string;
  evidence?: string;
  index?: string;
  json?: boolean | string;
  run: string;
  soft?: boolean;
  status?: string;
  suggestion?: string;
  title?: string;
  verdict: string;
}

async function resultIngestAction(options: ResultIngestOptions): Promise<void> {
  const client = await getTrpcClient();
  const created = await client.verify.ingestResult.mutate({
    checkItemId: options.check,
    checkItemIndex: options.index ? Number.parseInt(options.index, 10) : undefined,
    checkItemTitle: options.title,
    confidence: options.confidence ? Number.parseFloat(options.confidence) : undefined,
    required: options.soft ? false : undefined,
    status: options.status as any,
    suggestion: options.suggestion,
    toulmin: options.evidence ? { evidence: options.evidence } : undefined,
    verdict: options.verdict as any,
    verifyRunId: options.run,
  });
  if (options.json !== undefined) {
    outputJson(created, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Result ${pc.bold(created.id)} (${created.verdict})`);
}

async function resultListAction(options: {
  json?: boolean | string;
  operation?: string;
  run?: string;
}): Promise<void> {
  if (!options.run && !options.operation) {
    log.error('Provide either --run or --operation');
    process.exit(1);
  }
  const client = await getTrpcClient();
  const results = options.run
    ? await client.verify.listResultsByRun.query({ verifyRunId: options.run })
    : await client.verify.listResults.query({ operationId: options.operation! });
  if (options.json !== undefined) {
    outputJson(results, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (results.length === 0) return void console.log('No results yet.');
  printResults(results);
}

interface SubmitOptions {
  by?: string;
  content?: string;
  desc?: string;
  file?: string;
  item: string;
  json?: boolean | string;
  operation?: string;
  run?: string;
  title?: string;
  type?: string;
  verdict?: string;
}

async function submitAction(options: SubmitOptions): Promise<void> {
  if (!options.run && !options.operation) {
    log.error('Provide --run <verifyRunId> or --operation <operationId>');
    process.exit(1);
  }
  const hasEvidence = Boolean(options.file) || Boolean(options.content);
  if (Boolean(options.file) && Boolean(options.content)) {
    log.error('Provide at most one of --file or --content');
    process.exit(1);
  }
  if (hasEvidence && !options.type) {
    log.error('--type is required when attaching evidence');
    process.exit(1);
  }
  if (!hasEvidence && !options.verdict) {
    log.error('Provide evidence (--file/--content) and/or a --verdict');
    process.exit(1);
  }
  const client = await getTrpcClient();
  let fileId: string | undefined;
  let inlineContent = options.content;
  if (options.file) {
    inlineContent = inlineTextEvidenceForFile(options.file, options.type!);
    if (inlineContent === undefined) {
      const uploaded = await uploadLocalFile(client, options.file);
      fileId = uploaded.id;
    }
  }
  const evidence = hasEvidence
    ? [
        {
          capturedBy: options.by as any,
          content: inlineContent,
          description: options.desc,
          fileId,
          type: options.type as any,
        },
      ]
    : undefined;
  const res = await client.verify.submitCheckEvidence.mutate({
    checkItemId: options.item,
    checkItemTitle: options.title,
    evidence,
    operationId: options.operation,
    verdict: options.verdict as any,
    verifyRunId: options.run,
  });
  if (options.json !== undefined) {
    outputJson(res, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(
    `${pc.green('✓')} Submitted ${pc.bold(res.checkResult.id)}` +
      `${res.checkResult.verdict ? ` (${res.checkResult.verdict})` : ''}` +
      `${res.evidence.length > 0 ? ` +${res.evidence.length} evidence` : ''}`,
  );
}

async function decisionAction(resultId: string, decision: Decision): Promise<void> {
  if (decision !== undefined && !DECISIONS.includes(decision)) {
    log.error(`decision must be one of: ${DECISIONS.join(', ')}`);
    process.exit(1);
  }
  const client = await getTrpcClient();
  await client.verify.submitDecision.mutate({ decision, resultId });
  console.log(`${pc.green('✓')} Recorded ${pc.bold(decision)} on result ${pc.bold(resultId)}`);
}

// ── evidence ──

interface EvidenceUploadOptions {
  by?: string;
  check: string;
  content?: string;
  desc?: string;
  file?: string;
  json?: boolean | string;
  type: string;
}

async function evidenceUploadAction(options: EvidenceUploadOptions): Promise<void> {
  if (Boolean(options.file) === Boolean(options.content)) {
    log.error('Provide exactly one of --file or --content');
    process.exit(1);
  }
  const client = await getTrpcClient();
  let fileId: string | undefined;
  let inlineContent = options.content;
  if (options.file) {
    inlineContent = inlineTextEvidenceForFile(options.file, options.type);
    if (inlineContent === undefined) {
      const uploaded = await uploadLocalFile(client, options.file);
      fileId = uploaded.id;
    }
  }
  const ev = await client.verify.uploadEvidence.mutate({
    capturedBy: options.by as any,
    checkResultId: options.check,
    content: inlineContent,
    description: options.desc,
    fileId,
    type: options.type as any,
  });
  if (options.json !== undefined) {
    outputJson(ev, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Evidence ${pc.bold(ev.id)}${fileId ? ` (file ${fileId})` : ''}`);
}

async function evidenceListAction(
  checkResultId: string,
  options: { json?: boolean | string },
): Promise<void> {
  const client = await getTrpcClient();
  const rows = await client.verify.listEvidence.query({ checkResultId });
  if (options.json !== undefined) {
    outputJson(rows, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (rows.length === 0) return void console.log('No evidence.');
  printTable(
    rows.map((e: any) => [
      e.id,
      e.type,
      e.capturedBy ?? '',
      e.fileId ? 'file' : 'inline',
      truncate(e.description || '', 40),
    ]),
    ['ID', 'TYPE', 'BY', 'PAYLOAD', 'DESC'],
  );
}

async function evidenceDeleteAction(
  evidenceId: string,
  options: { json?: boolean | string },
): Promise<void> {
  const client = await getTrpcClient();
  const result = await client.verify.deleteEvidence.mutate({ id: evidenceId });
  if (options.json !== undefined) {
    outputJson(result, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Deleted evidence ${pc.bold(result.id)}`);
}

// ── report ──

interface ReportUpsertOptions {
  content?: string;
  failed?: string;
  json?: boolean | string;
  passed?: string;
  run: string;
  summary?: string;
  total?: string;
  uncertain?: string;
  verdict?: string;
}

async function reportUpsertAction(options: ReportUpsertOptions): Promise<void> {
  const num = (s?: string) => (s === undefined ? undefined : Number.parseInt(s, 10));
  const client = await getTrpcClient();
  const created = await client.verify.upsertReport.mutate({
    content: options.content,
    failedChecks: num(options.failed),
    passedChecks: num(options.passed),
    summary: options.summary,
    totalChecks: num(options.total),
    uncertainChecks: num(options.uncertain),
    verdict: options.verdict as any,
    verifyRunId: options.run,
  });
  if (options.json !== undefined) {
    outputJson(created, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Report ${pc.bold(created.id)} (${created.verdict ?? '—'})`);
}

async function reportGetAction(runId: string, options: { json?: boolean | string }): Promise<void> {
  const client = await getTrpcClient();
  const item = await client.verify.getReport.query({ verifyRunId: runId });
  if (options.json !== undefined) {
    outputJson(item, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (!item) return void console.log('No report.');
  console.log(JSON.stringify(item, null, 2));
}

// ── ingest-report (aggregate convenience over the atomic commands) ──

interface IngestReportOptions {
  goal?: string;
  json?: boolean | string;
  open?: boolean;
  operation?: string;
  requirement?: string;
  source?: string;
  subject?: string;
  title?: string;
}

async function ingestReportAction(reportDir: string, options: IngestReportOptions): Promise<void> {
  const dir = path.resolve(reportDir);
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

  const cases: any[] = Array.isArray(result.cases) ? result.cases : [];
  const summary = result.summary ?? {};
  const reportMdPath = path.join(dir, 'report.md');
  const content = existsSync(reportMdPath) ? readFileSync(reportMdPath, 'utf8') : undefined;

  // What kind of delivery this report verified (default: coding).
  const scenario = scenarioFromResult(result);

  // The scenario's context for the report's scope header. Coding lifts the
  // well-known top-level fields (branch / commit / surfaces / PR); every
  // other scenario passes result.json `context` through as its own bag.
  // `pullRequest` is hoisted: the success output (text and --json) prints
  // the PR link after the ingest, whatever the scenario resolved to.
  let context: Record<string, unknown> | undefined;
  let pullRequest: ReturnType<typeof pullRequestFromResult>;
  if (scenario === 'coding') {
    const branch = typeof result.branch === 'string' ? result.branch : undefined;
    const surfaces = surfacesFromResult(result);
    // An authored PR wins; otherwise ask `gh` what the branch's PR is, so the
    // report links to it without the author having to remember the field.
    pullRequest = pullRequestFromResult(result) ?? pullRequestFromBranch(branch);
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
  const plan = planFromResult(result);

  // Every agent-testing report belongs to an acceptance. Explicit CLI input
  // wins, then result.json, then the authoring topic echoed by the runtime.
  let subject = subjectFromResult(result);
  if (options.subject) {
    const ref = parseSubjectRef(options.subject);
    if (!ref) {
      log.error(
        `--subject must be one of ${acceptanceSubjectTypes.map((t) => `${t}:<id>`).join(' | ')}`,
      );
      process.exit(1);
    }
    subject = { ref, requirement: subject?.requirement };
  } else if (result.subject && !subject) {
    log.error('result.json `subject` is malformed (expected "type:id" or {type,id})');
    process.exit(1);
  } else if (!subject) {
    const ref = subjectFromEnv();
    if (ref) subject = { ref };
  }
  if (!subject) {
    log.error(
      'Acceptance subject is required: run inside a LobeHub topic or pass --subject task:<id> | topic:<id> | document:<id>',
    );
    process.exit(1);
  }
  const requirement = options.requirement ?? subject?.requirement;

  const client = await getTrpcClient();
  const goal = options.goal ?? (typeof result.focus === 'string' ? result.focus : undefined);
  const title = options.title ?? result.title;
  // The title is the run's identity in every list surface — an untitled
  // run renders as a placeholder forever, so say so before it ships.
  if (!title) {
    log.warn(
      'result.json has no "title" — the run will list as untitled; set result.title (or pass --title)',
    );
  }
  // The in-app conversation that ran this harness, if any (env-supplied).
  // Strictly the authoring conversation. `--operation` names the Agent Run
  // under test and is passed to `createRun` below — a different relation.
  const origin = originFromEnv();
  const newRunMetadata = metadataForReport(result, undefined, origin);

  // Every ingest is a new immutable verification snapshot. A repair or
  // re-verification is represented by another run on the same acceptance.
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
  const runId = run.id;

  // 1c. Chain the session onto its subject's acceptance as the next round
  //     BEFORE the report lands, so the report-time status rollup already
  //     sees the aggregate.
  const acceptance = await client.acceptance.ensure.mutate({
    requirement,
    subjectId: subject.ref.subjectId,
    subjectType: subject.ref.subjectType,
  });
  const acceptanceId = acceptance.id;
  const attached = await client.acceptance.attachRun.mutate({ acceptanceId, verifyRunId: runId });
  // The chained round's index — `?r=<roundIndex>` on the acceptance URL
  // deep-links this round's report as the fixed snapshot view.
  const roundIndex = attached?.roundIndex ?? null;

  // 2. Ingest each case as a check result + its evidence. `checkItemId` is
  //    the stable key within this immutable run.
  const seenCheckItemIds = new Set<string>();
  let evidenceCount = 0;
  let inlined = 0;
  for (const [index, c] of cases.entries()) {
    const checkItemId = String(c.id ?? c.checkItemId ?? `case-${index + 1}`);
    seenCheckItemIds.add(checkItemId);
    const verdict = toVerdict(c.result ?? c.status ?? c.verdict);
    const observation = c.keyObservation ?? c.observation ?? c.note;
    const checkResult = await client.verify.ingestResult.mutate({
      checkItemId,
      checkItemIndex: index,
      checkItemTitle: c.name ?? c.case ?? c.title ?? checkItemId,
      required: c.required ?? true,
      // The case's key observation is recorded as Toulmin evidence; a real
      // remediation hint (if the report provides one) goes to `suggestion`.
      // Absent → explicit `null`, so this immutable snapshot records the
      // absence instead of relying on upsert defaults.
      suggestion: typeof c.suggestion === 'string' ? c.suggestion : null,
      toulmin: typeof observation === 'string' ? { evidence: observation } : null,
      verdict,
      verifierType: 'agent',
      verifyRunId: runId,
    });

    for (const evidenceInput of reportEvidence(c.evidence)) {
      const rel = evidenceInput.path;
      const abs = path.isAbsolute(rel) ? rel : path.join(dir, rel);
      if (!existsSync(abs)) {
        log.warn(`evidence not found, skipping: ${rel}`);
        continue;
      }
      try {
        const type = evidenceTypeForFile(abs);
        const inlineContent = inlineTextEvidenceForFile(abs, type);
        const file = inlineContent === undefined ? await uploadLocalFile(client, abs) : undefined;
        await client.verify.uploadEvidence.mutate({
          capturedBy: 'cli',
          checkResultId: checkResult.id,
          // The filename, not the case title — the title already heads the
          // check card, so reusing it here just triples the same text.
          content: inlineContent,
          description: evidenceInput.description ?? path.basename(abs),
          fileId: file?.id,
          metadata: evidenceInput.comparison ? { comparison: evidenceInput.comparison } : undefined,
          type,
        });
        evidenceCount += 1;
        if (inlineContent !== undefined) inlined += 1;
      } catch (e) {
        // A stub/unreachable storage bucket (common in local dev) fails the
        // file PUT — don't abort the whole ingest over one artifact; the
        // session, results, and report are the deliverable.
        log.warn(`evidence upload failed, skipping ${path.basename(abs)}: ${String(e)}`);
      }
    }
  }

  // 3. Write the report. `summary` is the overall conclusion (rendered at
  //    the top of the report page); `content` is the full markdown detail.
  const conclusion =
    typeof summary.conclusion === 'string'
      ? summary.conclusion
      : typeof summary.note === 'string'
        ? summary.note
        : undefined;
  // A 0-100 quality score lands on overallConfidence (0-1); the report page
  // surfaces it as the `score` stat.
  const score =
    typeof summary.score === 'number' ? Math.max(0, Math.min(1, summary.score / 100)) : undefined;
  await client.verify.upsertReport.mutate({
    content,
    failedChecks: summary.failed,
    overallConfidence: score,
    passedChecks: summary.passed,
    summary: conclusion,
    totalChecks: summary.total ?? cases.length,
    uncertainChecks: (summary.blocked ?? 0) + (summary.uncertain ?? 0) || undefined,
    // An explicit summary.verdict wins; otherwise the headline is derived
    // from the ingested cases (deriveReportVerdict) so no report ships
    // verdict-less and lists as a permanent "?".
    verdict: summary.verdict ? toVerdict(summary.verdict) : deriveReportVerdict(cases),
    verifyRunId: runId,
  });

  // A case with no matching plan item means the run checked something it
  // never planned — worth saying out loud, but not a failure. Only
  // meaningful against a plan that actually names something: with no plan
  // (or a cleared one) every case is trivially "unplanned", which is noise.
  const unplanned = plan?.length
    ? [...seenCheckItemIds].filter((id) => !plan.some((item) => item.id === id))
    : [];

  if (options.json !== undefined) {
    outputJson(
      {
        acceptanceId,
        cases: cases.length,
        evidence: evidenceCount,
        inlined,
        origin,
        planItems: plan?.length ?? 0,
        pullRequest,
        roundIndex,
        scenario,
        subject: subject.ref,
        unplanned,
        verifyRunId: runId,
      },
      typeof options.json === 'string' ? options.json : undefined,
    );
    return;
  }

  console.log(
    `${pc.green('✓')} Ingested ${pc.bold(String(cases.length))} case(s), ${pc.bold(String(evidenceCount))} evidence artifact(s)` +
      `${inlined > 0 ? `, ${pc.bold(String(inlined))} inline` : ''}`,
  );
  if (plan?.length) {
    const unexecuted = plan.filter((item) => !seenCheckItemIds.has(item.id));
    console.log(
      `${pc.bold('plan')}: ${plan.length} item(s)` +
        `${unexecuted.length > 0 ? pc.yellow(` — ${unexecuted.length} planned but not executed`) : ''}` +
        `${unplanned.length > 0 ? pc.dim(` — ${unplanned.length} unplanned case(s)`) : ''}`,
    );
  }
  if (pullRequest?.url) console.log(`${pc.bold('pr')}: ${pullRequest.url}`);
  if (origin?.topicId) console.log(`${pc.bold('origin topic')}: ${origin.topicId}`);
  console.log(`${pc.bold('verifyRunId')}: ${runId} ${pc.dim('(immutable snapshot)')}`);
  console.log(
    `${pc.bold('acceptance')}: ${acceptanceId} ${pc.dim(`(${subject.ref.subjectType}:${subject.ref.subjectId})`)}`,
  );
  if (options.open) {
    // The acceptance page is the only link surfaced to users — the raw /verify
    // page stays internal. `?r=<roundIndex>` is this round's fixed snapshot.
    console.log(`${pc.bold('open acceptance')}: /acceptance/${acceptanceId}`);
    if (roundIndex !== null) {
      console.log(`${pc.bold('round snapshot')}: /acceptance/${acceptanceId}?r=${roundIndex}`);
    }
  }
}

// ── Option wiring (shared by both trees) ───────────────────
//
// Each `withXxxOptions` applies the flag set to a freshly-created command, so
// the canonical and deprecated spellings always accept exactly the same flags.

function withInstallOptions(cmd: Command): Command {
  return cmd
    .option('--dir <path>', 'Target working directory (default: current dir)')
    .option('--skill <id>', 'Skill identifier to pull', 'acceptance')
    .option('--force', 'Overwrite existing skill files')
    .option('--no-gitignore', 'Do not record the installed skill in .gitignore')
    .option('--json [fields]', 'Output JSON');
}

function withRunCreateOptions(cmd: Command): Command {
  return cmd
    .option('--source <source>', 'agent | agent-testing', 'agent-testing')
    .option('--operation <id>', 'Link to an existing Agent Run')
    .option('--title <title>', 'Session title')
    .option('--goal <goal>', 'Goal/task being verified')
    .option('--json [fields]', 'Output JSON');
}

function withRunDeleteOptions(cmd: Command): Command {
  return cmd
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json [fields]', 'Output JSON');
}

function withResultIngestOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--run <verifyRunId>', 'Target session id')
    .requiredOption('--check <checkItemId>', 'Stable check item id within the session')
    .requiredOption('--verdict <verdict>', 'passed|failed|uncertain')
    .option('--title <title>', 'Check title')
    .option('--index <n>', 'Display index')
    .option('--confidence <n>', '0-1 confidence')
    .option('--status <status>', 'pending|running|passed|failed|skipped (derived from verdict)')
    .option('--evidence <text>', 'Key observation (stored as Toulmin evidence)')
    .option('--suggestion <text>', 'Remediation hint')
    .option('--soft', 'Non-blocking (required=false); defaults to blocking')
    .option('--json [fields]', 'Output JSON');
}

function withResultListOptions(cmd: Command): Command {
  return cmd
    .option('--run <verifyRunId>', 'List by verification session')
    .option('--operation <operationId>', 'List by Agent Run')
    .option('--json [fields]', 'Output JSON');
}

function withSubmitOptions(cmd: Command): Command {
  return cmd
    .option('--run <verifyRunId>', 'Target verification session (or use --operation)')
    .option('--operation <operationId>', 'Resolve the session from an Agent Run operation id')
    .requiredOption('--item <checkItemId>', 'Plan item id (checkItemId)')
    .option('--type <type>', 'screenshot|gif|video|text|dom_snapshot|transcript')
    .option('--file <path>', 'Local file to upload as the evidence artifact')
    .option('--content <text>', 'Inline text payload (instead of a file)')
    .option('--verdict <verdict>', 'passed|failed|uncertain')
    .option('--title <text>', 'Check item title snapshot')
    .option('--by <capturedBy>', 'agent-browser|cdp|cli|program|llm_judge', 'cli')
    .option('--desc <text>', 'Human-readable caption for the evidence')
    .option('--json [fields]', 'Output JSON');
}

function withEvidenceUploadOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--check <checkResultId>', 'Target check result id')
    .requiredOption('--type <type>', 'screenshot|gif|video|text|dom_snapshot|transcript')
    .option('--file <path>', 'Local file to upload as the artifact')
    .option('--content <text>', 'Inline text payload (instead of a file)')
    .option('--by <capturedBy>', 'agent-browser|cdp|cli|program|llm_judge', 'cli')
    .option('--desc <text>', 'Human-readable caption')
    .option('--json [fields]', 'Output JSON');
}

function withReportUpsertOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--run <verifyRunId>', 'Target session id')
    .option('--verdict <verdict>', 'passed|failed|uncertain')
    .option('--summary <text>', 'Short summary')
    .option('--content <markdown>', 'Full markdown body')
    .option('--total <n>', 'Total checks')
    .option('--passed <n>', 'Passed checks')
    .option('--failed <n>', 'Failed checks')
    .option('--uncertain <n>', 'Uncertain checks')
    .option('--json [fields]', 'Output JSON');
}

function withIngestReportOptions(cmd: Command): Command {
  return cmd
    .option('--source <source>', 'agent | agent-testing', 'agent-testing')
    .option('--operation <id>', 'Link the session to an existing Agent Run')
    .option('--title <title>', 'Override the session title')
    .option('--goal <goal>', 'The goal/task being verified')
    .option(
      '--subject <type:id>',
      'Override the required acceptance subject (defaults to the current LOBEHUB_TOPIC_ID)',
    )
    .option(
      '--requirement <text>',
      'Acceptance requirement recorded when the aggregate is first created',
    )
    .option('--open', 'Print the in-app URL to open the report')
    .option('--json [fields]', 'Output JSON');
}

// ── Canonical tree: `lh acceptance install` + `lh acceptance run …` ──

/**
 * The run-scoped acceptance commands. A run is one immutable round of a
 * subject's acceptance; its results, evidence, and report are its sub-resources.
 * Attached to the first-class `lh acceptance` command.
 */
export function attachAcceptanceRunCommands(acceptance: Command): void {
  withInstallOptions(
    acceptance
      .command('install')
      .description(
        'Install the acceptance skill skeleton into .agents/skills/acceptance (pulled from the server)',
      ),
  ).action(installAction);

  withInstallOptions(
    acceptance
      .command('update')
      .description('Re-pull the acceptance skill, overwriting local files and re-wiring harnesses'),
  ).action((options: InstallOptions) => installAction({ ...options, force: true }));

  const run = acceptance
    .command('run')
    .description('Acceptance rounds (immutable verification snapshots)');

  withIngestReportOptions(
    run
      .command('ingest <reportDir>')
      .description(
        'Ingest a local agent-testing report (result.json + report.md + assets) as a new round',
      ),
  ).action(ingestReportAction);

  withRunCreateOptions(
    run.command('create').description('Create a standalone round (verification session)'),
  ).action(runCreateAction);

  run
    .command('list')
    .description('List recent rounds')
    .option('--json [fields]', 'Output JSON')
    .action(runListAction);

  run
    .command('get <runId>')
    .description('Show a round')
    .option('--json [fields]', 'Output JSON')
    .action(runGetAction);

  withRunDeleteOptions(
    run
      .command('delete <runId>')
      .description('Delete a round (cascades its results, evidence and report)'),
  ).action(runDeleteAction);

  const result = run.command('result').description('Check results within a round');
  withResultIngestOptions(
    result
      .command('ingest')
      .description('Upsert one check result by (run, checkItemId) from a supplied verdict'),
  ).action(resultIngestAction);
  withResultListOptions(
    result
      .command('list')
      .description('List check results — by round (--run) or by Agent Run (--operation)'),
  ).action(resultListAction);
  withSubmitOptions(
    result
      .command('submit')
      .description('Submit a check item — upsert its result and attach evidence in one call'),
  ).action(submitAction);
  result
    .command('decision <resultId> <decision>')
    .description(`Record human feedback on a result (${DECISIONS.join('|')})`)
    .action(decisionAction);

  const evidence = run.command('evidence').description('Evidence artifacts within a round');
  withEvidenceUploadOptions(
    evidence
      .command('upload')
      .description('Attach an evidence artifact (file or inline text) to a check result'),
  ).action(evidenceUploadAction);
  evidence
    .command('list <checkResultId>')
    .description('List evidence for a check result')
    .option('--json [fields]', 'Output JSON')
    .action(evidenceListAction);
  evidence
    .command('delete <evidenceId>')
    .description('Delete an evidence artifact')
    .option('--json [fields]', 'Output JSON')
    .action(evidenceDeleteAction);

  const report = run.command('report').description('The narrative report of a round');
  withReportUpsertOptions(
    report.command('upsert').description('Write (overwrite) the report for a round'),
  ).action(reportUpsertAction);
  report
    .command('get <runId>')
    .description('Show the report for a round')
    .option('--json [fields]', 'Output JSON')
    .action(reportGetAction);
}

// ── Deprecated aliases: keep the old `lh verify …` spellings working ──

/** Warn once that a `lh verify` spelling has moved under `lh acceptance`. */
function deprecate(cmd: Command, replacement: string): Command {
  return cmd.hook('preAction', () => {
    log.warn(
      `\`lh verify ${cmd.name()}\` is deprecated — use \`${replacement}\` (removed in a future release)`,
    );
  });
}

/**
 * The pre-move `lh verify …` command surface, kept as thin aliases that wire the
 * exact same actions. Scheduled for removal once callers migrate to
 * `lh acceptance`. Layout mirrors the original flat shape so existing scripts and
 * tests keep working.
 */
export function attachDeprecatedVerifyRunAliases(verify: Command): void {
  // Both legacy spellings — `verify init` (server pull) and `verify install`
  // (the old bundled-skill installer) — converge on `acceptance install`.
  deprecate(
    withInstallOptions(
      verify.command('init').description('Deprecated — use `lh acceptance install`'),
    ),
    'lh acceptance install',
  ).action(installAction);

  deprecate(
    withInstallOptions(
      verify.command('install').description('Deprecated — use `lh acceptance install`'),
    ),
    'lh acceptance install',
  ).action(installAction);

  deprecate(
    withIngestReportOptions(
      verify
        .command('ingest-report <reportDir>')
        .description('Deprecated — use `lh acceptance run ingest`'),
    ),
    'lh acceptance run ingest',
  ).action(ingestReportAction);

  const run = verify.command('run').description('Deprecated — use `lh acceptance run`');
  deprecate(
    withRunCreateOptions(
      run.command('create').description('Deprecated — use `lh acceptance run create`'),
    ),
    'lh acceptance run create',
  ).action(runCreateAction);
  run
    .command('list')
    .description('Deprecated — use `lh acceptance run list`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn('`lh verify run list` is deprecated — use `lh acceptance run list`'),
    )
    .action(runListAction);
  run
    .command('get <runId>')
    .description('Deprecated — use `lh acceptance run get`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn('`lh verify run get` is deprecated — use `lh acceptance run get`'),
    )
    .action(runGetAction);
  deprecate(
    withRunDeleteOptions(
      run.command('delete <runId>').description('Deprecated — use `lh acceptance run delete`'),
    ),
    'lh acceptance run delete',
  ).action(runDeleteAction);

  const result = verify
    .command('result')
    .description('Deprecated — use `lh acceptance run result`');
  deprecate(
    withResultIngestOptions(
      result.command('ingest').description('Deprecated — use `lh acceptance run result ingest`'),
    ),
    'lh acceptance run result ingest',
  ).action(resultIngestAction);
  deprecate(
    withResultListOptions(
      result.command('list').description('Deprecated — use `lh acceptance run result list`'),
    ),
    'lh acceptance run result list',
  ).action(resultListAction);

  deprecate(
    withSubmitOptions(
      verify.command('submit').description('Deprecated — use `lh acceptance run result submit`'),
    ),
    'lh acceptance run result submit',
  ).action(submitAction);

  verify
    .command('decision <resultId> <decision>')
    .description('Deprecated — use `lh acceptance run result decision`')
    .hook('preAction', () =>
      log.warn('`lh verify decision` is deprecated — use `lh acceptance run result decision`'),
    )
    .action(decisionAction);

  const evidence = verify
    .command('evidence')
    .description('Deprecated — use `lh acceptance run evidence`');
  deprecate(
    withEvidenceUploadOptions(
      evidence
        .command('upload')
        .description('Deprecated — use `lh acceptance run evidence upload`'),
    ),
    'lh acceptance run evidence upload',
  ).action(evidenceUploadAction);
  evidence
    .command('list <checkResultId>')
    .description('Deprecated — use `lh acceptance run evidence list`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn('`lh verify evidence list` is deprecated — use `lh acceptance run evidence list`'),
    )
    .action(evidenceListAction);
  evidence
    .command('delete <evidenceId>')
    .description('Deprecated — use `lh acceptance run evidence delete`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn(
        '`lh verify evidence delete` is deprecated — use `lh acceptance run evidence delete`',
      ),
    )
    .action(evidenceDeleteAction);

  const report = verify
    .command('report')
    .description('Deprecated — use `lh acceptance run report`');
  deprecate(
    withReportUpsertOptions(
      report.command('upsert').description('Deprecated — use `lh acceptance run report upsert`'),
    ),
    'lh acceptance run report upsert',
  ).action(reportUpsertAction);
  report
    .command('get <runId>')
    .description('Deprecated — use `lh acceptance run report get`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn('`lh verify report get` is deprecated — use `lh acceptance run report get`'),
    )
    .action(reportGetAction);
}
