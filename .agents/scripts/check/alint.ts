import path from 'node:path';

import { run, toolCommand } from './exec';
import { exists, rootDir } from './paths';
import type { LintOutcome, LintProblem } from './types';

/**
 * Opt-in `--alint` selector: model-backed rules from `.agents/alint/rules`
 * (see `.agents/alint/README.md`). Files outside every config group are
 * skipped by alint itself, so the whole changed set can be passed through.
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

export const runAlint = async (files: string[]): Promise<LintOutcome> => {
  const root = rootDir();
  if (!(await exists(path.join(root, '.alint/config.toml'))))
    return {
      fatal: ['alint: no provider setup — run `bun run alint:setup` (needs ALINT_API_KEY)'],
      problems: [],
    };

  const bin = await toolCommand(root, 'alint');
  const result = await run(bin, ['--format', 'json', ...files], root);
  const problems = parseAlintJson(result.stdout, root);
  if (problems) return { fatal: [], problems };
  return {
    fatal: [`alint: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`],
    problems: [],
  };
};
