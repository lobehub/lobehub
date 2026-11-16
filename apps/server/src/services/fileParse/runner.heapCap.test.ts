import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

// A V8 heap flag of the PARENT process (CLI or NODE_OPTIONS) overrides `resourceLimits` of every
// worker (Node docs, `new Worker` > `resourceLimits`). It has to be a real parent process: the
// flag is read at process start, so setting `process.env` inside this test would prove nothing.
// The runner is bundled once and driven in a child `node`, started with the flags under test.
const RUNNER = fileURLToPath(new URL('./runner.ts', import.meta.url));
const BUDGET_MB = 768;

const DRIVER = `
import { createFileParseRunner } from ${JSON.stringify(RUNNER)};
const [workerPath, marker, oomLimitMb] = process.argv.slice(2);
const outcome = async (promise) => {
  try { return { value: await promise }; } catch (e) { return { code: e.code, message: e.message }; }
};
(async () => {
  const runner = createFileParseRunner({ workerPath: () => workerPath });
  const results = [];
  results.push(await outcome(runner.run({ marker, scenario: 'heap' })));
  results.push(await outcome(runner.run({ marker, scenario: 'heap' })));
  if (oomLimitMb) {
    const small = createFileParseRunner({
      maxOldGenerationSizeMb: Number(oomLimitMb),
      workerPath: () => workerPath,
    });
    results.push(await outcome(small.run({ marker, scenario: 'oom' })));
    results.push(await outcome(small.run({ marker, scenario: 'heap' })));
    results.push(small.stats());
  }
  results.push(runner.stats());
  console.log(JSON.stringify(results));
})();
`;

// What a parser would see: the heap limit of its thread, reported after the marker is written.
const SCENARIOS = `
import { appendFileSync } from 'node:fs';
import v8 from 'node:v8';
import { parentPort, workerData as job } from 'node:worker_threads';

appendFileSync(job.marker, 'x');
if (job.scenario === 'oom') { const hold = []; for (;;) hold.push(new Array(100000).fill('x'.repeat(16))); }
parentPort.postMessage({ type: 'result', value: v8.getHeapStatistics().heap_size_limit / 1048576 });
`;

let dir: string;
let driverPath: string;
let workerPath: string;
let markerCounter = 0;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-heapcap-'));
  workerPath = path.join(dir, 'scenarios.mjs');
  driverPath = path.join(dir, 'driver.cjs');
  const entry = path.join(dir, 'driver.mjs');
  await writeFile(workerPath, SCENARIOS);
  await writeFile(entry, DRIVER);
  await build({
    bundle: true,
    entryPoints: [entry],
    format: 'cjs',
    logLevel: 'silent',
    outfile: driverPath,
    platform: 'node',
  });
}, 60_000);

afterAll(() => rm(dir, { force: true, recursive: true }));

const spawnDriver = async (flags: { args?: string[]; nodeOptions?: string }, oomLimitMb = '') => {
  const marker = path.join(dir, `started-${markerCounter++}`);
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  if (flags.nodeOptions !== undefined) env.NODE_OPTIONS = flags.nodeOptions;
  const { stdout } = await run(
    process.execPath,
    [...(flags.args ?? []), driverPath, workerPath, marker, oomLimitMb],
    { env, timeout: 60_000 },
  );
  return { marker, results: JSON.parse(stdout.trim().split('\n').pop()!) as any[] };
};

describe('parent V8 heap flags vs the worker memory budget', () => {
  it('runs with the configured heap when the parent sets no heap flag, and recovers from OOM', async () => {
    const { marker, results } = await spawnDriver({}, '64');

    // Young generation is on top of the old generation budget; both runs are the same bounded thread.
    expect(results[0].value).toBeGreaterThan(BUDGET_MB);
    expect(results[0].value).toBeLessThan(BUDGET_MB + 400);
    expect(results[1].value).toBe(results[0].value);
    // A real heap exhaustion is typed, frees the slot, and the next job still runs.
    expect(results[2]).toMatchObject({ code: 'OUT_OF_MEMORY' });
    expect(results[3].value).toBeGreaterThan(64);
    expect(results[4]).toEqual({ active: 0, queued: 0 });
    expect(results[5]).toEqual({ active: 0, queued: 0 });
    expect(existsSync(marker)).toBe(true);
  }, 60_000);

  // Every form that gives the parent a larger old-space limit: CLI or NODE_OPTIONS, `-` or `_`.
  it.each([
    ['CLI --max-old-space-size', { args: ['--max-old-space-size=4096'] }],
    ['CLI --max_old_space_size', { args: ['--max_old_space_size=4096'] }],
    ['NODE_OPTIONS --max-old-space-size', { nodeOptions: '--max-old-space-size=4096' }],
    ['NODE_OPTIONS --max_old_space_size', { nodeOptions: '--max_old_space_size=4096' }],
    ['NODE_OPTIONS --max-heap-size', { nodeOptions: '--max-heap-size=4096' }],
  ])(
    'refuses before loading any parser when the parent has %s above the budget',
    async (_, flags) => {
      const { marker, results } = await spawnDriver(flags);

      for (const result of results.slice(0, 2)) {
        expect(result).toMatchObject({ code: 'START_FAILED' });
        expect(result.message).toMatch(/--max-old-space-size/);
      }
      // The scenario (the parser entry) never ran, the slot is free and the queue still moves.
      expect(existsSync(marker)).toBe(false);
      expect(results[2]).toEqual({ active: 0, queued: 0 });
    },
    60_000,
  );

  it.each([
    ['equal to the budget', { nodeOptions: `--max-old-space-size=${BUDGET_MB}` }, 768],
    ['smaller than the budget', { nodeOptions: '--max-old-space-size=256' }, 256],
    ['smaller, as CLI', { args: ['--max_old_space_size=256'] }, 256],
  ])(
    'keeps working when the parent flag is %s (the heap is not larger)',
    async (_, flags, mb) => {
      const { marker, results } = await spawnDriver(flags);

      expect(results[0].value).toBeGreaterThanOrEqual(mb);
      expect(results[0].value).toBeLessThan(mb + 400);
      expect(results[1].value).toBe(results[0].value);
      expect(existsSync(marker)).toBe(true);
    },
    60_000,
  );

  // `--max-old-space-size 4096` (space) is a Node option, not a V8 one. Whatever this Node does
  // with it, it must never end as a parse that starts with the larger heap: either it is accepted
  // and the runner refuses (START_FAILED, parser never started), or Node refuses to start.
  it.each([
    ['CLI', { args: ['--max-old-space-size', '4096'] }],
    ['NODE_OPTIONS', { nodeOptions: '--max-old-space-size 4096' }],
  ])(
    'never starts a parser with a larger heap for the space-separated form (%s)',
    async (_, flags) => {
      const outcome = await spawnDriver(flags).then(
        (value) => ({ value }),
        (error: { code?: number; stderr?: string }) => ({ error }),
      );

      if ('error' in outcome) {
        // Node rejected the flag itself: an actual option error, not a crash from something else.
        expect(outcome.error.stderr).toMatch(
          /--max-old-space-size|requires an argument|not allowed/,
        );
        return;
      }
      for (const result of outcome.value.results.slice(0, 2)) {
        expect(result).toMatchObject({ code: 'START_FAILED' });
      }
      expect(existsSync(outcome.value.marker)).toBe(false);
    },
    60_000,
  );
});
