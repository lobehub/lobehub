import path from 'node:path';

import { run, toolCommand } from './exec';
import { exists, rootDir } from './paths';
import type { LintOutcome, LintProblem } from './types';

/**
 * Opt-in `--alint` selector: model-backed rules from `packages/alint/rules`
 * (see `packages/alint/README.md`). Files outside every config group are
 * skipped by alint itself, so the whole changed set can be passed through.
 *
 * With no explicit paths the scope matches CI: `alint --dirty` keeps only
 * findings on changed lines, so touching a file does not surface every older
 * violation in it. Explicit paths lint those files whole.
 */

interface AlintDiagnostic {
  filePath: string;
  loc?: { start?: { line?: number } };
  message: string;
  ruleId: string;
  severity: 'error' | 'warn';
}

/** `alint --format json` → LintProblem[]; null when stdout is not alint JSON. */
export const parseAlintJson = (stdout: string, root: string): LintProblem[] | null => {
  try {
    const { diagnostics } = JSON.parse(stdout) as { diagnostics: AlintDiagnostic[] };
    return diagnostics.map((diagnostic) => ({
      file: path.relative(root, diagnostic.filePath),
      line: diagnostic.loc?.start?.line ?? 0,
      // Keep only the first line: alint appends a "Suggestion:" paragraph.
      message: diagnostic.message.split('\n')[0],
      rule: diagnostic.ruleId,
      severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    }));
  } catch {
    return null;
  }
};

interface AlintScope {
  /** Default git scope: lint changed lines only, like CI. False for explicit paths. */
  changedLinesOnly: boolean;
}

/** CLI arguments that select what alint lints. */
export const alintScopeArgs = (files: string[], { changedLinesOnly }: AlintScope): string[] =>
  changedLinesOnly ? ['--dirty'] : files;

/** `--dirty` also covers unstaged files; keep only the selected set (e.g. `--staged`). */
export const keepSelectedFiles = (
  problems: LintProblem[],
  files: string[],
  { changedLinesOnly }: AlintScope,
): LintProblem[] => {
  if (!changedLinesOnly) return problems;
  const selected = new Set(files);
  return problems.filter((problem) => selected.has(problem.file));
};

export const runAlint = async (files: string[], scope: AlintScope): Promise<LintOutcome> => {
  const root = rootDir();
  if (!(await exists(path.join(root, '.alint/config.toml'))))
    return {
      fatal: ['alint: no provider setup — run `bun run alint:setup` (needs ALINT_API_KEY)'],
      problems: [],
    };

  const bin = await toolCommand(root, 'alint');
  const result = await run(bin, ['--format', 'json', ...alintScopeArgs(files, scope)], root);
  const problems = parseAlintJson(result.stdout, root);
  if (problems) return { fatal: [], problems: keepSelectedFiles(problems, files, scope) };
  return {
    fatal: [`alint: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`],
    problems: [],
  };
};
