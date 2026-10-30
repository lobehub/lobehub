import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const main = async () => {
  const output = path.resolve(argument('--output') ?? '.records/stylex-migration-experiment/pilot');
  const runner = path.join(repoRoot, '.records/stylex-migration-experiment/runner');
  await mkdir(output, { recursive: true });
  const steps: Array<{ command: string[]; durationMs: number }> = [];
  const execute = (program: string, args: string[]) => {
    console.log(`Starting ${program} ${args.join(' ')}`);
    const started = performance.now();
    execFileSync(program, args, {
      cwd: repoRoot,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: 'inherit',
    });
    steps.push({ command: [program, ...args], durationMs: performance.now() - started });
  };
  const source = (file: string) => path.join(repoRoot, 'scripts/stylexMigration/experiment', file);
  if (!process.argv.includes('--reuse-build'))
    execute('bun', [source('index.ts'), '--output', output, '--build-only']);
  execute('bun', [
    'build',
    ...['index', 'suite', 'reproduce', 'benchmark', 'parity'].map((name) => source(`${name}.ts`)),
    '--target=node',
    '--packages=external',
    '--entry-naming',
    '[name].mjs',
    '--outdir',
    runner,
  ]);
  const node = (name: string, args: string[]) =>
    execute('node', [path.join(runner, `${name}.mjs`), ...args]);
  node('index', ['--output', output, '--reuse-build', '--engine', 'shell']);
  node('index', ['--output', output, '--reuse-build', '--engine', 'shell', '--backend', 'fast']);
  node('index', ['--output', output, '--reuse-build', '--engine', 'chrome', '--backend', 'fast']);
  for (const backend of ['strict', 'fast'])
    for (const engine of ['shell', 'chrome'])
      node('suite', [
        path.join(output, 'boundaries', backend),
        engine,
        ...(backend === 'fast' ? ['--fast'] : []),
      ]);
  node('reproduce', [output]);
  node('parity', [output]);
  node('benchmark', [output]);
  execute('bun', [source('inventory.ts'), output]);
  execute('bun', [source('parser.ts'), output]);
  await writeFile(
    path.join(output, 'execution.json'),
    JSON.stringify({ finishedAt: new Date().toISOString(), steps }, null, 2),
  );
  execute('bun', [source('report.ts'), output]);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
