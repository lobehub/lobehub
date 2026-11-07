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

const emptyOutcome = (): TestOutcome => ({ failedOutput: [], noMatch: [], passed: 0 });

/** Run vitest from a config dir and fold its result into `outcome`; returns the test-file count. */
const runVitest = async (
  configDir: string,
  args: string[],
  outcome: TestOutcome,
  unmatched: string[],
): Promise<number> => {
  const cwd = path.join(rootDir(), configDir);
  const vitestBin = await toolCommand(cwd, 'vitest');
  const result = await run(vitestBin, [...args, '--silent=passed-only', '--passWithNoTests'], cwd);

  const passedMatch = result.stdout.match(/Tests\s+(\d+) passed/);
  if (passedMatch) outcome.passed += Number(passedMatch[1]);

  if (result.code !== 0) {
    outcome.failedOutput.push(
      `# vitest (${configDir})\n${compactVitestOutput(result.stdout + result.stderr)}`,
    );
  } else if (!passedMatch) {
    outcome.noMatch.push(...unmatched);
  }
  const filesMatch = result.stdout.match(/Test Files\s+.*\((\d+)\)/);
  return filesMatch ? Number(filesMatch[1]) : 0;
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

  const outcome = emptyOutcome();
  await Promise.all(
    [...groups.entries()].map(([configDir, files]) =>
      runVitest(
        configDir,
        ['run', ...files],
        outcome,
        files.map((file) => path.join(configDir, file)),
      ),
    ),
  );
  return outcome;
};

/**
 * Config dirs whose tests can import the source files: each file's nearest
 * config, the root of the repo it lives in, the host root (a host test can
 * reach a mounted repo's module through a path alias), and the configs owning
 * `knownTests`, such as a sibling package's tests found by the import lookup.
 */
export const relatedConfigDirs = async (
  sourceFiles: string[],
  knownTests: string[],
  mountDirOf: (file: string) => string,
) => {
  const dirs = await Promise.all([
    ...sourceFiles.map((file) => findVitestConfigDir(file, existsInRepo)),
    ...knownTests.map((file) => findVitestConfigDir(file, existsInRepo)),
  ]);
  return [...new Set([...dirs, ...sourceFiles.map((file) => mountDirOf(file) || '.'), '.'])];
};

/**
 * `--related`: `vitest related` from every config in `relatedConfigDirs`.
 * It follows the full module graph, but costs tens of seconds: each run builds
 * the graph of every test in its config. Returns the outcome and the number of
 * test files run.
 */
export const runRelatedGroups = async (
  sourceFiles: string[],
  knownTests: string[],
  mountDirOf: (file: string) => string,
): Promise<{ fileCount: number; outcome: TestOutcome }> => {
  if (sourceFiles.length === 0) return { fileCount: 0, outcome: emptyOutcome() };
  const files = sourceFiles.map((file) => path.join(rootDir(), file));
  const configDirs = await relatedConfigDirs(sourceFiles, knownTests, mountDirOf);

  const outcome = emptyOutcome();
  const counts = await Promise.all(
    configDirs.map((configDir) =>
      runVitest(configDir, ['related', '--run', ...files], outcome, []),
    ),
  );
  return { fileCount: counts.reduce((sum, count) => sum + count, 0), outcome };
};
