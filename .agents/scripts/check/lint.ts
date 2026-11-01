import path from 'node:path';

import { runTool } from './exec';
import { mountDir } from './paths';
import { stylelintApplies } from './routing';
import type { LintOutcome, LintProblem, RepoMount } from './types';

const filePrefix = (mount: RepoMount) => (mount.dir === '' ? '' : `${mount.dir}/`);

const parseEslintJson = (stdout: string, mount: RepoMount): LintProblem[] | null => {
  try {
    const results = JSON.parse(stdout) as {
      filePath: string;
      messages: { line?: number; message: string; ruleId: string | null; severity: number }[];
    }[];
    return results.flatMap((result) =>
      result.messages
        // ruleId=null entries are eslint's own notices (e.g. ignored-file warnings)
        .filter((message) => message.ruleId !== null)
        .map((message) => ({
          file: filePrefix(mount) + path.relative(mountDir(mount), result.filePath),
          line: message.line ?? 0,
          message: message.message,
          rule: message.ruleId ?? '',
          severity: message.severity === 2 ? ('error' as const) : ('warning' as const),
        })),
    );
  } catch {
    return null;
  }
};

const parseStylelintJson = (stdout: string, mount: RepoMount): LintProblem[] | null => {
  try {
    const results = JSON.parse(stdout) as {
      source: string;
      warnings: { line?: number; rule: string; severity: string; text: string }[];
    }[];
    return results.flatMap((result) =>
      result.warnings.map((warning) => ({
        file: filePrefix(mount) + path.relative(mountDir(mount), result.source),
        line: warning.line ?? 0,
        message: warning.text,
        rule: warning.rule,
        severity: warning.severity === 'error' ? ('error' as const) : ('warning' as const),
      })),
    );
  } catch {
    return null;
  }
};

const mountLabel = (mount: RepoMount) => mount.dir || '.';

/** Run one mount's pipeline (autofix mode) over a file group, collecting remaining problems. */
export const lintGroup = async (
  mount: RepoMount,
  tools: string[][],
  subPaths: string[],
): Promise<LintOutcome> => {
  const outcome: LintOutcome = { fatal: [], problems: [] };

  for (const toolArgs of tools) {
    const [tool] = toolArgs;
    if (tool === 'eslint') {
      const result = await runTool(
        mount,
        [...toolArgs, '--format', 'json', '--no-warn-ignored'],
        subPaths,
      );
      const problems = parseEslintJson(result.stdout, mount);
      if (problems) outcome.problems.push(...problems);
      else if (result.code !== 0)
        outcome.fatal.push(
          `eslint(${mountLabel(mount)}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
    } else if (tool === 'stylelint') {
      const scoped = subPaths.filter((subPath) => stylelintApplies(subPath));
      if (scoped.length === 0) continue;
      const result = await runTool(
        mount,
        [...toolArgs, '--formatter', 'json', '--allow-empty-input'],
        scoped,
      );
      const problems = parseStylelintJson(result.stdout || result.stderr, mount);
      if (problems) outcome.problems.push(...problems);
      else if (result.code !== 0)
        outcome.fatal.push(
          `stylelint(${mountLabel(mount)}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
    } else {
      const result = await runTool(mount, toolArgs, subPaths);
      if (result.code !== 0)
        outcome.fatal.push(
          `${tool}(${mountLabel(mount)}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
    }
  }

  return outcome;
};
