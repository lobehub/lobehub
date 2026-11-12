import type { AgentEvalRunTopicResult } from '@lobechat/types';

import { runStats } from './lobeBench';

interface ExperimentCase {
  id: string;
  metadata?: Record<string, unknown> | null;
}

export type ExperimentCaseFilter = 'all' | 'allFail' | 'diff' | 'errors' | 'judgeErrors';

export const defaultExperimentCaseFilter = (contenderCount: number): ExperimentCaseFilter =>
  contenderCount > 1 ? 'diff' : 'all';

/** An unfinished comparison must not imply that a completed contender has won. */
export const orderExperimentContenders = <T>(
  contenders: T[],
  passed: (contender: T) => number,
  incomplete: boolean,
) => (incomplete ? [...contenders] : [...contenders].sort((a, b) => passed(b) - passed(a)));

export const isUnavailableExperimentResult = (
  runStatus: string | undefined,
  results: Array<{ testCaseId: string }> | undefined,
  caseId: string,
) =>
  !!results &&
  ['completed', 'failed', 'aborted'].includes(runStatus ?? '') &&
  !results.some((item) => item.testCaseId === caseId);

/** Selection IDs are dataset-native IDs, not necessarily database primary keys. */
export const scopeExperimentCases = <T extends ExperimentCase>(
  cases: T[],
  selectedIds?: string[],
) => {
  if (!selectedIds?.length) return { cases, missingCount: 0, selectedCount: cases.length };
  const selected = new Set(selectedIds);
  const available = new Set<string>();
  const scoped = cases.filter((item) => {
    const nativeId = item.metadata?.caseId;
    const id = typeof nativeId === 'string' && nativeId ? nativeId : item.id;
    if (!selected.has(id)) return false;
    available.add(id);
    return true;
  });
  return {
    cases: scoped,
    missingCount: selected.size - available.size,
    selectedCount: selected.size,
  };
};

/** Compare preserved summary totals with evidence, without recomputing historic grades. */
export const experimentResultCoverage = (
  expected: number,
  results: Array<{ testCaseId: string }> | undefined,
) => {
  if (!results) return undefined;
  const available = new Set(results.map((item) => item.testCaseId)).size;
  return { available, expected, missing: Math.max(0, expected - available) };
};

export type AttemptGradeState =
  'awaitingExternal' | 'error' | 'graded' | 'judgeError' | 'noAnswer' | 'ungraded';

interface GradeAttempt {
  awaitingExternalEval?: boolean;
  error?: string | null;
  errorPhase?: string;
  passed?: boolean | null;
  rubricScores?: unknown[] | null;
  status?: string | null;
}

/** A present result row is evidence of an attempt, not proof that grading finished. */
export const attemptGradeState = (attempt: GradeAttempt): AttemptGradeState => {
  if (attempt.status === 'judge_error' || attempt.errorPhase === 'judge') return 'judgeError';
  if (
    attempt.status === 'error' ||
    attempt.status === 'timeout' ||
    attempt.error === 'No assistant output'
  )
    return 'error';
  if (['passed', 'failed'].includes(attempt.status ?? '') && attempt.rubricScores?.length)
    return 'graded';
  if (attempt.status === 'completed' && typeof attempt.passed === 'boolean') return 'graded';
  if (attempt.status === 'failed' && !attempt.rubricScores?.length && attempt.error)
    return 'noAnswer';
  if (attempt.status === 'external' || attempt.awaitingExternalEval) return 'awaitingExternal';
  return 'ungraded';
};

/** Live evidence counts, separate from the final quality estimates stored on a run. */
export const experimentPassProgress = (
  results: AgentEvalRunTopicResult[] | undefined,
  k: number,
  total: number,
) => {
  if (!results) return undefined;
  let allPassed = 0;
  let anyPassed = 0;
  let evaluated = 0;
  let errors = 0;
  let hasVerdicts = false;
  const cases = new Map(results.map((result) => [result.testCaseId, result]));
  for (const result of cases.values()) {
    const evaluation = result.evalResult;
    const threads = evaluation?.threads;
    const attempts: GradeAttempt[] = threads?.length
      ? threads
      : [{ ...evaluation, passed: result.passed, status: result.status }];
    const states = attempts.map(attemptGradeState);
    const passed = attempts.filter(
      (attempt, index) => states[index] === 'graded' && attempt.passed === true,
    ).length;
    const caseError =
      states.some((state) => state === 'error' || state === 'judgeError') ||
      ['error', 'timeout', 'judge_error'].includes(result.status ?? '') ||
      evaluation?.errorPhase === 'judge';
    const distinct = !threads?.length || new Set(threads.map((t) => t.threadId)).size === k;
    const graded = attempts.every(
      (attempt, index) =>
        (states[index] === 'graded' && typeof attempt.passed === 'boolean') ||
        states[index] === 'noAnswer',
    );
    const complete = !caseError && attempts.length === k && distinct && graded;
    if (passed > 0) anyPassed++;
    if (complete && passed === k) allPassed++;
    if (complete) evaluated++;
    if (caseError) errors++;
    if (
      complete ||
      attempts.some((attempt, i) => states[i] === 'graded' && typeof attempt.passed === 'boolean')
    )
      hasVerdicts = true;
  }
  return {
    allPassed,
    anyPassed,
    complete: total > 0 && evaluated === total && cases.size === total && results.length === total,
    errors,
    evaluated,
    hasVerdicts,
    pending: Math.max(0, total - evaluated - errors),
  };
};

/** Keep the table and complete-state insights on the same preserved verdict counts. */
export const experimentRunStats = (
  run: Parameters<typeof runStats>[0],
  results: AgentEvalRunTopicResult[] | undefined,
  totalCases?: number,
) => {
  const stats = runStats(run, totalCases);
  const progress = experimentPassProgress(results, stats.k, stats.total);
  return {
    ...stats,
    anyK: progress?.anyPassed ?? stats.anyK,
    passed: progress?.allPassed ?? stats.passed,
    progress,
  };
};

export const experimentGradingCoverage = (results: AgentEvalRunTopicResult[]) => {
  const counts: Record<AttemptGradeState, number> = {
    awaitingExternal: 0,
    error: 0,
    graded: 0,
    judgeError: 0,
    noAnswer: 0,
    ungraded: 0,
  };
  for (const topic of results) {
    const evaluation = topic.evalResult;
    const attempts: GradeAttempt[] = evaluation?.threads?.length
      ? evaluation.threads
      : [
          {
            awaitingExternalEval: evaluation?.awaitingExternalEval,
            error: evaluation?.error,
            errorPhase: evaluation?.errorPhase,
            passed: topic.passed,
            rubricScores: evaluation?.rubricScores,
            status: topic.status,
          },
        ];
    for (const attempt of attempts) counts[attemptGradeState(attempt)]++;
  }
  return counts;
};

const UNVERIFIED_STATUSES = new Set(['error', 'judge_error', 'timeout']);

/**
 * Cases Rerun would run again: the case, or any of its attempts, has no verdict
 * (the model never answered, timed out, or the judge could not grade it).
 * Mirrors the server's `needsRerun`.
 */
export const unverifiedCaseCount = (results: AgentEvalRunTopicResult[] | undefined) =>
  (results ?? []).filter(
    (topic) =>
      UNVERIFIED_STATUSES.has(topic.status ?? '') ||
      topic.evalResult?.error === 'No assistant output' ||
      (topic.evalResult?.threads ?? []).some(
        (thread) =>
          UNVERIFIED_STATUSES.has(thread.status ?? '') || thread.error === 'No assistant output',
      ),
  ).length;

export interface ExperimentGradingGap {
  awaitingExternal: number;
  id: string;
  judgeError: number;
  name: string;
  ungraded: number;
}

export const experimentGradingGaps = (
  contenders: Array<{ id: string; name: string; runId?: string }>,
  runs: Array<{ id: string; status: string }>,
  resultsMap: Record<string, AgentEvalRunTopicResult[]> | undefined,
): ExperimentGradingGap[] =>
  contenders.flatMap((contender) => {
    const run = runs.find((item) => item.id === contender.runId);
    const results = contender.runId ? resultsMap?.[contender.runId] : undefined;
    if (!run || !results || !['completed', 'failed', 'aborted'].includes(run.status)) return [];
    const coverage = experimentGradingCoverage(results);
    return coverage.ungraded || coverage.awaitingExternal || coverage.judgeError
      ? [
          {
            id: contender.id,
            name: contender.name,
            ungraded: coverage.ungraded,
            judgeError: coverage.judgeError,
            awaitingExternal: coverage.awaitingExternal,
          },
        ]
      : [];
  });

interface ResultResource {
  error?: unknown;
  loaded: boolean;
}

/** An error is never an empty experiment or a zero score; cached data survives refresh errors. */
export const experimentResultsState = (resources: ResultResource[]) => {
  const failed = resources.find((item) => !item.loaded && item.error);
  if (failed) return 'error';
  if (resources.some((item) => !item.loaded)) return 'loading';
  return 'ready';
};

export const lowestPassRateCategory = <T extends { rate: number | undefined }>(categories: T[]) =>
  categories
    .filter((item): item is T & { rate: number } => item.rate !== undefined && item.rate < 1)
    .sort((a, b) => a.rate - b.rate)[0];

interface ExperimentCsvCase extends ExperimentCase {
  category: string;
  index: number;
  results: string[];
  title: string;
}

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@']);

/**
 * Spreadsheet apps evaluate a cell that starts with a formula trigger, even
 * after leading whitespace or control characters. Prefix such text with `'`
 * so an exported case title or model name is shown as text, never run.
 */
const neutralizeSpreadsheetFormula = (text: string) => {
  const first = [...text].find((char) => char.trim() !== '' && char.charCodeAt(0) > 0x1f);
  return first && FORMULA_TRIGGERS.has(first) ? `'${text}` : text;
};

/** A complete export of the experiment selection, independent of on-screen filters. */
export const createExperimentResultsCsv = (
  cases: ExperimentCsvCase[],
  contenderNames: string[],
  selectedIds?: string[],
) => {
  const quote = (value: string | number) => {
    const text = typeof value === 'string' ? neutralizeSpreadsheetFormula(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows = [...scopeExperimentCases(cases, selectedIds).cases]
    .sort((a, b) => a.index - b.index)
    .map((item) => [item.index, item.title, item.category, ...item.results]);
  return [['#', 'Case', 'Category', ...contenderNames], ...rows]
    .map((row) => row.map(quote).join(','))
    .join('\n');
};
