/// <reference types="node" />

/**
 * Agent-oriented quality check engine: `bun run check [files...] [--lint] [--test] [--type]`.
 *
 * Runs the lint-staged toolchain (with autofix) and/or related tests on the
 * given files, auto-routing each file to the right eslint/stylelint config
 * root (the host repo or a mounted sub-repo) and the nearest owning vitest
 * config. Output is compact and colorless so agents burn minimal tokens
 * reading it.
 *
 * `--lint` / `--test` / `--type` are composable selectors; no selector means
 * lint + test. File selection: explicit args, else all working-tree changes
 * (staged + unstaged + untracked) from every configured repo; `--staged`
 * narrows the default to staged files only.
 *
 * This module is the reusable engine: hosts call `runCli` with a
 * `CheckConfig`. This repo's standalone entry is `cli.ts`; a superproject
 * mounting this repo provides its own entry that adds its root pipelines and
 * mounts this repo's via `pipelines.ts`.
 */
import { findNewComponentTestAdvisories } from './advisories';
import { collectAutofixDiffs, snapshot, writeFullDiff } from './autofix';
import { collectFromGit, normalizeArgs } from './collect';
import { run } from './exec';
import { lintGroup } from './lint';
import { existsInRepo, setConfig } from './paths';
import { printReport } from './report';
import { pipelineFor, relatedTestCandidates, resolveMount } from './routing';
import type { CheckConfig, FileDiff, LintProblem, RepoMount, TestOutcome } from './types';
import { runTestGroups } from './vitest';

const USAGE = `Usage: bun run check [files...] [--lint] [--test] [--type] [--staged]
  Selectors compose; no selector = --lint --test.
  files     explicit paths; default = all working-tree changes (staged + unstaged + untracked)
  --staged  collect staged files only (pre-commit scope); ignored with explicit files
  --lint    lint pipelines (with autofix)
  --test    related tests
  --type    full type-check; alone, file collection is skipped`;

const KNOWN_FLAGS = new Set(['--lint', '--test', '--type', '--staged']);

/** Keep only candidates that exist on disk, preserving order. */
const filterExisting = async (candidates: string[]): Promise<string[]> => {
  const present = await Promise.all(candidates.map((candidate) => existsInRepo(candidate)));
  return candidates.filter((_, index) => present[index]);
};

export const runCli = async (config: CheckConfig) => {
  setConfig(config);

  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const unknownFlags = rawArgs.filter((arg) => arg.startsWith('--') && !KNOWN_FLAGS.has(arg));
  if (unknownFlags.length > 0) {
    console.error(`✗ unknown flag: ${unknownFlags.join(' ')}\n${USAGE}`);
    process.exit(2);
  }

  const wantLint = rawArgs.includes('--lint');
  const wantTest = rawArgs.includes('--test');
  const runType = rawArgs.includes('--type');
  const noSelector = !wantLint && !wantTest && !runType;
  const runLint = wantLint || noSelector;
  const runTest = wantTest || noSelector;

  const fileArgs = rawArgs.filter((arg) => !arg.startsWith('--'));

  let files: string[] = [];
  if (runLint || runTest) {
    files = await filterExisting(
      fileArgs.length > 0
        ? normalizeArgs(fileArgs)
        : await collectFromGit(rawArgs.includes('--staged')),
    );
    if (files.length === 0 && !runType) {
      console.log('✓ nothing to check (no changed files)');
      return;
    }
  } else if (fileArgs.length > 0) {
    console.log(`(files ignored: --type alone runs the full type-check)`);
  }

  /* ---- Lint (with autofix) first so tests run against the fixed code ---- */
  let problems: LintProblem[] = [];
  let fatal: string[] = [];
  let diffs: FileDiff[] = [];
  let skipped = 0;
  if (runLint) {
    // Group lintable files by (mount, pipeline); remember files with no matching linter.
    const lintGroups = new Map<
      string,
      { mount: RepoMount; subPaths: string[]; tools: string[][] }
    >();
    for (const file of files) {
      const { mount, subPath } = resolveMount(config.repos, file);
      const pipeline = pipelineFor(mount.pipelines, subPath);
      if (!pipeline) {
        skipped += 1;
        continue;
      }
      const key = `${mount.dir}:${pipeline.exts[0]}`;
      const group = lintGroups.get(key) ?? { mount, subPaths: [], tools: pipeline.tools };
      group.subPaths.push(subPath);
      lintGroups.set(key, group);
    }

    const before = await snapshot(files);
    const outcomes = await Promise.all(
      [...lintGroups.values()].map((group) => lintGroup(group.mount, group.tools, group.subPaths)),
    );
    problems = outcomes.flatMap((outcome) => outcome.problems);
    fatal = outcomes.flatMap((outcome) => outcome.fatal);
    diffs = await collectAutofixDiffs(before);
  }

  /* ---- Related tests ---- */
  let tests: TestOutcome | null = null;
  let testFiles: string[] = [];
  if (runTest) {
    testFiles = await filterExisting([
      ...new Set(files.flatMap((file) => relatedTestCandidates(file))),
    ]);
    tests = await runTestGroups(testFiles);
  }

  const advisories = await findNewComponentTestAdvisories([...new Set([...files, ...testFiles])]);

  /* ---- Type check ---- */
  let typeOutput: string | null = null;
  if (runType) {
    const result = await run('bun', ['run', 'type-check'], config.rootDir);
    typeOutput = result.code === 0 ? '' : (result.stdout + result.stderr).trim();
  }

  const fullDiffPath = diffs.length > 0 ? await writeFullDiff(diffs) : null;
  const { failed } = printReport({
    advisories,
    diffs,
    fatal,
    fileCount: files.length,
    fullDiffPath,
    lintRan: runLint,
    problems,
    skipped,
    testFileCount: testFiles.length,
    tests,
    typeOutput,
  });

  process.exit(failed ? 1 : 0);
};
