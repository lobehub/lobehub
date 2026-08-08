import path from 'node:path';

import { run, toolCommand } from './exec';
import { existsInRepo, rootDir } from './paths';
import { findVitestConfigDir } from './routing';
import type { TestOutcome } from './types';

/**
 * Compact vitest failure output: keep only the "Failed Tests" detail section
 * (assertions + code frames) and drop banners, timings, and separator noise.
 */
export const compactVitestOutput = (output: string): string => {
  const lines = output.split('\n');
  const failedIndex = lines.findIndex((line) => line.includes('Failed Tests'));
  const kept = (failedIndex === -1 ? lines : lines.slice(failedIndex + 1)).filter(
    (line) =>
      !/^\s*(?:RUN\s+v|Start at\s|Duration\s)/.test(line) &&
      !/^[⎯\s]*(?:\[\d+\/\d+\][⎯\s]*)?$/.test(line),
  );
  return kept.join('\n').trim();
};

/** Group test files by their owning vitest config dir and run each group from there. */
export const runTestGroups = async (testFiles: string[]): Promise<TestOutcome> => {
  const groups = new Map<string, string[]>();
  for (const file of testFiles) {
    const configDir = await findVitestConfigDir(file, existsInRepo);
    const list = groups.get(configDir) ?? [];
    list.push(path.relative(configDir, file));
    groups.set(configDir, list);
  }

  const outcome: TestOutcome = { failedOutput: [], noMatch: [], passed: 0 };

  await Promise.all(
    [...groups.entries()].map(async ([configDir, files]) => {
      const cwd = path.join(rootDir(), configDir);
      const vitestBin = await toolCommand(cwd, 'vitest');
      const result = await run(
        vitestBin,
        ['run', '--silent=passed-only', '--passWithNoTests', ...files],
        cwd,
      );

      const passedMatch = result.stdout.match(/Tests\s+(\d+) passed/);
      if (passedMatch) outcome.passed += Number(passedMatch[1]);

      if (result.code !== 0) {
        outcome.failedOutput.push(
          `# vitest (${configDir})\n${compactVitestOutput(result.stdout + result.stderr)}`,
        );
      } else if (!passedMatch) {
        outcome.noMatch.push(...files.map((file) => path.join(configDir, file)));
      }
    }),
  );

  return outcome;
};
