import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { VerifyAgentPlanConfig, VerifyCheckItem } from '@lobechat/types';

import { log } from '../../../utils/logger';
import {
  deriveReportVerdict,
  type EvidenceType,
  genericContextFromResult,
  planFromResult,
  pullRequestFromBranch,
  pullRequestFromResult,
  scenarioFromResult,
  screenProgrammaticTestChecks,
  surfacesFromResult,
  toVerdict,
  type Verdict,
  visualizationMetadata,
} from '../utils';

// ============================================
// One round directory (`result.json` + `report.md` + `proposal.md` +
// `assets/`), read the way every publication of it reads it. `ingest` uploads
// what this returns; a local report renders it. Sharing the reader is what
// keeps the two from disagreeing about which checks a round has, what each
// verdict is, or which evidence a pass is missing.
// ============================================

/** A round the author must fix before anything is published or rendered. */
export class ReportRoundError extends Error {
  readonly lines: string[];

  constructor(lines: string[]) {
    super(lines.join('\n'));
    this.lines = lines;
    this.name = 'ReportRoundError';
  }
}

export interface ReportRoundCase {
  case: any;
  checkItemId: string;
}

export interface ReportRound {
  allCases: any[];
  /** A PR the report itself names — a delivery claim, unlike the branch lookup. */
  authoredPullRequest: ReturnType<typeof pullRequestFromResult>;
  caseMetadata: ReturnType<typeof visualizationMetadata>[];
  cases: ReportRoundCase[];
  conclusion?: string;
  /** `report.md` — the narrative tail. */
  content?: string;
  context?: Record<string, unknown>;
  dir: string;
  droppedIds: Set<string>;
  droppedLabels: string[];
  goal?: string;
  plan?: VerifyCheckItem[];
  proposal: string;
  pullRequest: ReturnType<typeof pullRequestFromResult>;
  result: any;
  scenario: ReturnType<typeof scenarioFromResult>;
  summary: any;
  title?: string;
}

/**
 * Read a round directory. Throws {@link ReportRoundError} for a report that
 * cannot become a round (missing or invalid `result.json`, a gates-only round,
 * a visualization that cannot render) — before the first remote write.
 */
export function readReportRound(
  reportDir: string,
  options: {
    goal?: string;
    /** Ask `gh` for the branch's PR when the report names none (default: yes). */
    inferPullRequest?: boolean;
    /** Skip authoring warnings — the round is being re-read, not published. */
    quiet?: boolean;
    title?: string;
  } = {},
): ReportRound {
  const dir = path.resolve(reportDir);
  const resultPath = path.join(dir, 'result.json');
  if (!existsSync(resultPath)) throw new ReportRoundError([`result.json not found in ${dir}`]);

  let result: any;
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8'));
  } catch {
    throw new ReportRoundError(['result.json is not valid JSON']);
  }

  // Unit tests, type-checks and lint gates are preconditions of shipping, not
  // things a person accepts — a page full of them buries the checks that
  // actually needed a human eye. Screen them out of both the plan and the cases
  // before anything is published.
  const { droppedIds, droppedLabels } = screenProgrammaticTestChecks(result, {
    quiet: options.quiet,
  });
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
    throw new ReportRoundError([
      'every check in this round is a programmatic gate (tests / type-check / lint) — nothing here needs a human decision.',
      '  Verify what the delivery does, shows, or produces, and keep the gates as one line of report.md.',
    ]);
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
    pullRequest =
      authoredPullRequest ??
      (options.inferPullRequest === false ? undefined : pullRequestFromBranch(branch));
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
  const plan: VerifyCheckItem[] | undefined = planFromResult(result, droppedIds);

  const goal = options.goal ?? (typeof result.focus === 'string' ? result.focus : undefined);
  const title = options.title ?? result.title;
  // The title is the run's identity in every list surface — an untitled
  // run renders as a placeholder forever, so say so before it ships.
  if (!title && !options.quiet) {
    log.warn(
      'result.json has no "title" — the run will list as untitled; set result.title (or pass --title)',
    );
  }

  // The overall conclusion, rendered at the top of the report page.
  const conclusion =
    typeof summary.conclusion === 'string'
      ? summary.conclusion
      : typeof summary.note === 'string'
        ? summary.note
        : undefined;

  return {
    allCases,
    authoredPullRequest,
    caseMetadata,
    cases,
    conclusion,
    content,
    context,
    dir,
    droppedIds,
    droppedLabels,
    goal,
    plan,
    proposal,
    pullRequest,
    result,
    scenario,
    summary,
    title,
  };
}

/** One case as the check result a round records for it. */
export function caseResult(
  c: any,
  checkItemId: string,
  index: number,
  metadata: ReturnType<typeof visualizationMetadata>,
) {
  const verdict = toVerdict(c.result ?? c.status ?? c.verdict);
  const observation = c.keyObservation ?? c.observation ?? c.note;
  return {
    checkItemId,
    checkItemIndex: index,
    checkItemTitle: c.name ?? c.case ?? c.title ?? checkItemId,
    metadata,
    required: c.required ?? true,
    // The case's key observation is recorded as Toulmin evidence; a real
    // remediation hint (if the report provides one) goes to `suggestion`.
    // Absent → explicit `null`, so this immutable snapshot records the
    // absence instead of relying on upsert defaults.
    suggestion: typeof c.suggestion === 'string' ? c.suggestion : null,
    toulmin: typeof observation === 'string' ? { evidence: observation } : null,
    verdict,
  };
}

/** The evidence media a check requires that its published evidence lacks. */
export function requiredEvidenceGaps(
  plan: VerifyCheckItem[] | undefined,
  checkItemId: string,
  published: Set<EvidenceType>,
): EvidenceType[] {
  const config = plan?.find((item) => item.id === checkItemId)?.verifierConfig as
    VerifyAgentPlanConfig | undefined;
  const required = config?.requiredEvidence;
  return [...new Set(required?.map((spec) => spec.type as EvidenceType) ?? [])].filter(
    (type) => !published.has(type),
  );
}

/** A pass that lacks required evidence is published as uncertain, never as a pass. */
export function publishedVerdictFor(verdict: Verdict, gaps: EvidenceType[]): Verdict {
  return gaps.length > 0 && verdict === 'passed' ? 'uncertain' : verdict;
}

export const missingEvidenceLimitation = (gaps: EvidenceType[]) =>
  `Required evidence not published: ${gaps.join(', ')}.`;

/** Planned items that produced no case but required evidence: open gaps, not passes. */
export function unexecutedEvidenceGaps(
  plan: VerifyCheckItem[] | undefined,
  executed: Set<string>,
): { item: VerifyCheckItem; types: EvidenceType[] }[] {
  const unexecuted = plan?.filter((item) => !executed.has(item.id)) ?? [];
  return unexecuted.flatMap((item) => {
    const config = item.verifierConfig as VerifyAgentPlanConfig;
    const types = [
      ...new Set(config.requiredEvidence?.map((spec) => spec.type as EvidenceType) ?? []),
    ];
    return types.length > 0 ? [{ item, types }] : [];
  });
}

/**
 * The round's report row: the author's summary, recounted whenever screening
 * dropped a case or evidence is missing — a stats block that disagrees with the
 * visible check list is worse than no stats.
 */
export function settleReport(input: {
  allCasesCount: number;
  casesCount: number;
  conclusion?: string;
  content?: string;
  missingEvidenceCount: number;
  publishedVerdicts: Verdict[];
  summary: any;
}) {
  const { summary, publishedVerdicts } = input;
  // A 0-100 quality score lands on overallConfidence (0-1); the report page
  // surfaces it as the `score` stat.
  const score =
    typeof summary.score === 'number' ? Math.max(0, Math.min(1, summary.score / 100)) : undefined;
  const recount = input.casesCount !== input.allCasesCount || input.missingEvidenceCount > 0;
  const counted = (verdict: Verdict) => publishedVerdicts.filter((v) => v === verdict).length;
  const derivedVerdict = deriveReportVerdict(publishedVerdicts.map((verdict) => ({ verdict })));
  const reportVerdict =
    summary.verdict && input.casesCount === input.allCasesCount
      ? toVerdict(summary.verdict)
      : derivedVerdict;
  return {
    content: input.content,
    failedChecks: recount ? counted('failed') : summary.failed,
    overallConfidence: score,
    passedChecks: recount ? counted('passed') : summary.passed,
    summary: input.conclusion,
    totalChecks: recount ? publishedVerdicts.length : (summary.total ?? input.casesCount),
    uncertainChecks: recount
      ? counted('uncertain') || undefined
      : (summary.blocked ?? 0) + (summary.uncertain ?? 0) || undefined,
    // Missing evidence cannot be overridden by an authored "passed" summary.
    // Keep a real failure rather than hiding it behind an evidence warning.
    verdict:
      input.missingEvidenceCount > 0
        ? reportVerdict === 'failed' || derivedVerdict === 'failed'
          ? 'failed'
          : 'uncertain'
        : reportVerdict,
  };
}
