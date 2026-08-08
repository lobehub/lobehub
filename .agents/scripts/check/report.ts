import { renderDiffsForStdout } from './autofix';
import type { FileDiff, LintProblem, TestOutcome } from './types';

export interface ReportInput {
  advisories: string[];
  diffs: FileDiff[];
  fatal: string[];
  fileCount: number;
  /** Path of the untruncated autofix diff file, when any diff exists. */
  fullDiffPath: string | null;
  lintRan: boolean;
  problems: LintProblem[];
  /** Files with no matching lint pipeline (only counted when lint ran). */
  skipped: number;
  testFileCount: number;
  /** null when tests were not selected. */
  tests: TestOutcome | null;
  /** null = type-check not run; '' = clean; non-empty = failure output. */
  typeOutput: string | null;
}

/** Print the compact report; the summary line mentions only checks that ran. */
export const printReport = (input: ReportInput): { failed: boolean } => {
  const {
    advisories,
    diffs,
    fatal,
    fileCount,
    fullDiffPath,
    lintRan,
    problems,
    skipped,
    testFileCount,
    tests,
    typeOutput,
  } = input;

  const errors = problems.filter((problem) => problem.severity === 'error');
  const warnings = problems.filter((problem) => problem.severity === 'warning');
  const failed =
    errors.length > 0 ||
    fatal.length > 0 ||
    (tests?.failedOutput.length ?? 0) > 0 ||
    Boolean(typeOutput);

  const parts: string[] = [];
  if (lintRan || tests) parts.push(`${fileCount} files`);
  if (lintRan) {
    const lintPart =
      errors.length > 0 || warnings.length > 0
        ? `lint ${[
            errors.length > 0 ? `${errors.length} errors` : '',
            warnings.length > 0 ? `${warnings.length} warnings` : '',
          ]
            .filter(Boolean)
            .join(' ')}`
        : 'lint clean';
    parts.push(`${lintPart}${diffs.length > 0 ? ` (${diffs.length} auto-fixed)` : ''}`);
  }
  if (tests) {
    parts.push(
      testFileCount === 0
        ? 'tests none'
        : tests.failedOutput.length > 0
          ? 'tests failed'
          : `tests ${tests.passed} passed`,
    );
  }
  if (typeOutput !== null) parts.push(typeOutput ? 'types failed' : 'types clean');
  if (advisories.length > 0) parts.push(`${advisories.length} advisories`);
  if (skipped > 0) parts.push(`${skipped} skipped (no linter)`);

  console.log(`${failed ? '✗' : '✓'} ${parts.join(' · ')}`);

  if (problems.length > 0) {
    console.log('\nlint:');
    for (const problem of problems)
      console.log(
        `${problem.file}:${problem.line} ${problem.rule} ${problem.message}${problem.severity === 'warning' ? ' (warning)' : ''}`,
      );
  }
  for (const message of fatal) console.log(`\nlint fatal:\n${message}`);

  if (advisories.length > 0) {
    console.log('\nadvisories:');
    for (const advisory of advisories) console.log(`⚠ ${advisory}`);
  }

  if (tests && tests.failedOutput.length > 0)
    console.log(`\ntests:\n${tests.failedOutput.join('\n\n')}`);
  if (tests && tests.noMatch.length > 0)
    console.log(
      `\ntests skipped (not matched by owning vitest config): ${tests.noMatch.join(', ')}`,
    );

  if (typeOutput) console.log(`\ntypes:\n${typeOutput}`);

  if (diffs.length > 0 && fullDiffPath) {
    console.log(`\nauto-fixed (${diffs.length} files, full diff: ${fullDiffPath}):`);
    console.log(renderDiffsForStdout(diffs));
  }

  return { failed };
};
