import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { classifySource } from '../classify';
import { baselineRef } from './fixtures';
import { git, repoRoot } from './project';

const main = async () => {
  const output = path.resolve(process.argv[2] ?? '.records/stylex-migration-experiment/pilot');
  const started = performance.now();
  const baselineSha = await git('rev-parse', baselineRef);
  const refs = (
    await git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/refactor/stylex-*')
  )
    .split('\n')
    .filter(
      (ref) => !/stylex-(?:foundation|settings|acceptance-rest|acceptance-viewer)$/.test(ref),
    );
  const branches = await Promise.all(
    refs.map(async (ref) => {
      const sha = await git('rev-parse', ref);
      const files = (
        await git('diff', '--name-only', `${baselineSha}...${sha}`, '--', '*.ts', '*.tsx')
      )
        .split('\n')
        .filter(Boolean);
      return { files, ref, sha };
    }),
  );
  const files = [...new Set(branches.flatMap((branch) => branch.files))];
  const buffer = execFileSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot,
    input: files.map((file) => `${baselineSha}:${file}\n`).join(''),
    maxBuffer: 64 * 1024 * 1024,
  });
  let offset = 0;
  const reports: Array<ReturnType<typeof classifySource> & { file: string }> = [];
  for (const file of files) {
    const end = buffer.indexOf(10, offset);
    const header = buffer.subarray(offset, end).toString();
    offset = end + 1;
    if (header.endsWith(' missing')) continue;
    const size = Number(header.split(' ')[2]);
    const source = buffer.subarray(offset, offset + size).toString();
    offset += size + 1;
    if (file.startsWith('scripts/') || file.includes('.test.')) continue;
    const report = classifySource(source);
    if (report.legacyImports.length) reports.push({ ...report, file });
  }
  const kinds = Object.fromEntries(
    [...new Set(reports.flatMap((report) => report.kinds))].map((kind) => [
      kind,
      reports.filter((report) => report.kinds.includes(kind)).length,
    ]),
  );
  const tiers = Object.fromEntries(
    ['A', 'B', 'C', 'D'].map((tier) => [
      tier,
      reports.filter((report) => report.tier === tier).length,
    ]),
  );
  const result = {
    baselineSha,
    branches,
    durationMs: performance.now() - started,
    kinds,
    legacyStyleSourceFiles: reports.length,
    reports,
    scope:
      'Unique modified pre-migration TS/TSX files with legacy style imports in the 20 local batch PR refs; heuristic source inventory, not browser coverage.',
    tiers,
    uniqueChangedTsFiles: files.length,
  };
  await writeFile(path.join(output, 'batch-inventory.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      branches: branches.length,
      sourceFiles: reports.length,
      kinds,
      tiers,
      durationMs: result.durationMs,
    }),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
