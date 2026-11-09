import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';

import { loadConfig, runComparison } from '../run';
import { runSelfTest } from '../selftest';
import { formatSelfTest } from '../selftest/run';
import { saveSelfTest } from '../selftest/store';
import { DEFAULT_UI_DIR, startServer } from '../server';
import { loadRun } from '../server/api';
import { runStack } from '../stack';
import { annotateList, applyNotes, latestRunForPr, type NoteInput, reworkList } from './review';
import { formatStack, formatSummary } from './summary';
import { uiBuildStale } from './uiBuild';

const run = promisify(execFile);

const HELP = `style-equivalence — compare styled elements between two revisions

  bun run style-eq --pr <number>
  bun run style-eq --base <ref> --head <ref>
  bun run style-eq --stack [--stack-base <branch>]
  bun run style-eq self-test
  bun run style-eq serve <run-id|run-dir> [--port <n>] [--pin]
  bun run style-eq rework <run-id|run-dir|--pr <number>> [--json]
  bun run style-eq annotate <run-id|run-dir> [--json] [--apply <notes.json>]

Options:
  --config <file>     project config (default scripts/stylexMigration/style-equivalence.config.ts)
  --records <dir>     evidence directory (default .records/style-equivalence)
  --keep-worktrees    keep base/head worktrees for debugging
  --skip-calibration  do not run the project's real-mount calibration
  --mutations <n>     mutants to sample from equal cases (default 10, 0 turns it off)
  --pin               serve exactly this run instead of following newer runs on the same base
`;

const DEFAULT_STACK_BASE = 'test/stylex-migration-stack';

const revParse = async (repo: string, ref: string) =>
  (await run('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`])).stdout.trim();

const ensureObject = async (repo: string, sha: string) => {
  try {
    await run('git', ['-C', repo, 'cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    await run('git', ['-C', repo, 'fetch', '--quiet', 'origin', sha]);
  }
};

const resolvePullRequest = async (repo: string, pr: string) => {
  if (!/^[1-9]\d*$/.test(pr)) throw new Error('INVALID_PR_NUMBER');
  const { stdout } = await run(
    'gh',
    ['pr', 'view', pr, '--json', 'baseRefOid,headRefOid,headRefName,number,title'],
    { cwd: repo },
  );
  const { baseRefOid, headRefName, headRefOid, number, title } = JSON.parse(stdout) as {
    baseRefOid: string;
    headRefName: string;
    headRefOid: string;
    number: number;
    title: string;
  };
  await ensureObject(repo, baseRefOid);
  await ensureObject(repo, headRefOid);
  return { base: baseRefOid, head: headRefOid, pr: { branch: headRefName, number, title } };
};

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'apply': { type: 'string' },
      'base': { type: 'string' },
      'config': { type: 'string' },
      'head': { type: 'string' },
      'help': { short: 'h', type: 'boolean' },
      'json': { type: 'boolean' },
      'keep-worktrees': { type: 'boolean' },
      'mutations': { type: 'string' },
      'pin': { type: 'boolean' },
      'port': { type: 'string' },
      'pr': { type: 'string' },
      'records': { type: 'string' },
      'skip-calibration': { type: 'boolean' },
      'stack': { type: 'boolean' },
      'stack-base': { type: 'string' },
    },
  });
  if (values.help) return void console.log(HELP);
  const repo = process.cwd();
  const configFile = path.resolve(
    values.config ?? 'scripts/stylexMigration/style-equivalence.config.ts',
  );
  const recordsDir = path.resolve(values.records ?? '.records/style-equivalence');
  if (positionals[0] === 'self-test') {
    const report = await runSelfTest({ configFile, recordsDir, repo });
    await saveSelfTest(recordsDir, report, new Date().toISOString());
    console.log(formatSelfTest(report));
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  const runDirOf = async (target: string | undefined) => {
    if (!target && values.pr) return latestRunForPr(recordsDir, Number(values.pr));
    if (!target) throw new Error('Specify a run id, a run directory or --pr <number>');
    const dir = existsSync(path.resolve(target))
      ? path.resolve(target)
      : path.join(recordsDir, target);
    if (!existsSync(path.join(dir, 'run.json'))) throw new Error(`No stored run at ${dir}`);
    return dir;
  };
  if (positionals[0] === 'rework') {
    const stored = await loadRun(await runDirOf(positionals[1]));
    console.log(await reworkList(stored, values.json ? 'json' : 'text'));
    return;
  }
  if (positionals[0] === 'annotate') {
    const stored = await loadRun(await runDirOf(positionals[1]));
    if (values.apply) {
      const notes = JSON.parse(await readFile(path.resolve(values.apply), 'utf8')) as NoteInput[];
      await applyNotes(stored, notes);
      console.log(`Stored ${notes.length} notes.`);
      return;
    }
    const list = await annotateList(stored);
    if (values.json) return void console.log(JSON.stringify(list, null, 2));
    if (!list.length) return void console.log('没有需要 agent 读码的项。');
    for (const entry of list)
      console.log(
        [
          `- ${entry.key} [${entry.state}]`,
          `  ${entry.ask}`,
          `  ${entry.source.base}`,
          `  ${entry.source.head}`,
        ].join('\n'),
      );
    return;
  }
  if (positionals[0] === 'serve') {
    const target = positionals[1];
    if (!target) throw new Error('serve takes a run id or run directory');
    const runDir = existsSync(path.resolve(target))
      ? path.resolve(target)
      : path.join(recordsDir, target);
    if (!existsSync(path.join(runDir, 'run.json'))) throw new Error(`No stored run at ${runDir}`);
    const packageDir = path.resolve(import.meta.dirname, '../..');
    const uiSources = [
      path.join(packageDir, 'src'),
      path.join(packageDir, 'report.vite.config.ts'),
    ];
    if (await uiBuildStale(DEFAULT_UI_DIR, uiSources)) {
      console.log('Building the report UI…');
      await run('bunx', ['vite', 'build', '--config', 'report.vite.config.ts'], {
        cwd: packageDir,
        maxBuffer: 64 * 1024 ** 2,
      });
    }
    const layoutComponents = await loadConfig(configFile).then(
      (config) => config.layoutComponents,
      (): string[] => [],
    );
    const server = await startServer({
      layoutComponents,
      pin: values.pin ?? false,
      port: Number(values.port ?? 0),
      recordsDir,
      runDir,
    });
    console.log(`Report: ${server.url}`);
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    await server.stop();
    return;
  }
  if (positionals.length) throw new Error(`Unknown command ${positionals[0]}`);
  if (values.mutations !== undefined && !/^\d+$/.test(values.mutations))
    throw new Error('--mutations takes a non-negative integer');
  const mutations = values.mutations === undefined ? undefined : Number(values.mutations);
  if (values.stack) {
    const stackBase = values['stack-base'] ?? DEFAULT_STACK_BASE;
    const { stdout } = await run(
      'gh',
      [
        'pr',
        'list',
        '--base',
        stackBase,
        '--state',
        'open',
        '--limit',
        '200',
        '--json',
        'number,headRefOid',
      ],
      { cwd: repo },
    );
    const heads = (JSON.parse(stdout) as Array<{ headRefOid: string; number: number }>)
      .sort((a, b) => a.number - b.number)
      .map((pr) => ({ id: String(pr.number), sha: pr.headRefOid }));
    await ensureObject(repo, await revParse(repo, stackBase));
    for (const head of heads) await ensureObject(repo, head.sha);
    const result = await runStack({
      base: stackBase,
      configFile,
      heads,
      mutations,
      recordsDir,
      repo,
    });
    console.log(formatStack(result));
    process.exitCode = result.mergeable ? 0 : result.conflicts.length ? 3 : 1;
    return;
  }
  const revisions = values.pr
    ? await resolvePullRequest(repo, values.pr)
    : values.base && values.head
      ? { base: values.base, head: values.head }
      : undefined;
  if (!revisions) throw new Error('Specify --pr <number>, --stack or both --base and --head');
  const result = await runComparison({
    ...revisions,
    calibrate: !values['skip-calibration'],
    configFile,
    keepWorktrees: values['keep-worktrees'],
    mutations,
    recordsDir,
    repo,
  });
  console.log(formatSummary(result));
  const open = (category: string) =>
    result.verdict.items.some((item) => item.category === category && item.signoff !== 'valid');
  const mismatch = result.calibration.some((entry) => entry.status === 'mismatch');
  process.exitCode = result.verdict.mergeable
    ? 0
    : open('blocking') || !result.mutation.passed || mismatch
      ? 3
      : open('difference')
        ? 1
        : 2;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 3;
});
