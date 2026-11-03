import { execFile } from 'node:child_process';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';

import { runComparison } from '../run';
import { runSelfTest } from '../selftest';
import { formatSelfTest } from '../selftest/run';
import { formatSummary } from './summary';

const run = promisify(execFile);

const HELP = `style-equivalence — compare styled elements between two revisions

  bun run style-eq --pr <number>
  bun run style-eq --base <ref> --head <ref>
  bun run style-eq self-test

Options:
  --config <file>     project config (default scripts/stylexMigration/style-equivalence.config.ts)
  --records <dir>     evidence directory (default .records/style-equivalence)
  --keep-worktrees    keep base/head worktrees for debugging
  --mutations <n>     mutants to sample from equal cases (default 10, 0 turns it off)
`;

const ensureObject = async (repo: string, sha: string) => {
  try {
    await run('git', ['-C', repo, 'cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    await run('git', ['-C', repo, 'fetch', '--quiet', 'origin', sha]);
  }
};

const resolvePullRequest = async (repo: string, pr: string) => {
  if (!/^[1-9]\d*$/.test(pr)) throw new Error('INVALID_PR_NUMBER');
  const { stdout } = await run('gh', ['pr', 'view', pr, '--json', 'baseRefOid,headRefOid'], {
    cwd: repo,
  });
  const { baseRefOid, headRefOid } = JSON.parse(stdout) as {
    baseRefOid: string;
    headRefOid: string;
  };
  await ensureObject(repo, baseRefOid);
  await ensureObject(repo, headRefOid);
  return { base: baseRefOid, head: headRefOid };
};

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'base': { type: 'string' },
      'config': { type: 'string' },
      'head': { type: 'string' },
      'help': { short: 'h', type: 'boolean' },
      'keep-worktrees': { type: 'boolean' },
      'mutations': { type: 'string' },
      'pr': { type: 'string' },
      'records': { type: 'string' },
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
    console.log(formatSelfTest(report));
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  if (positionals.length) throw new Error(`Unknown command ${positionals[0]}`);
  const revisions = values.pr
    ? await resolvePullRequest(repo, values.pr)
    : values.base && values.head
      ? { base: values.base, head: values.head }
      : undefined;
  if (!revisions) throw new Error('Specify --pr <number> or both --base and --head');
  if (values.mutations !== undefined && !/^\d+$/.test(values.mutations))
    throw new Error('--mutations takes a non-negative integer');
  const result = await runComparison({
    ...revisions,
    configFile,
    keepWorktrees: values['keep-worktrees'],
    mutations: values.mutations === undefined ? undefined : Number(values.mutations),
    recordsDir,
    repo,
  });
  console.log(formatSummary(result));
  const has = (category: string) => result.cases.some((entry) => entry.category === category);
  process.exitCode =
    has('blocking') || !result.mutation.passed
      ? 3
      : has('difference')
        ? 1
        : has('needs-signoff') || result.unpaired
          ? 2
          : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 3;
});
