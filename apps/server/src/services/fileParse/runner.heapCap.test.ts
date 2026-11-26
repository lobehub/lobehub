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
  const { stderr, stdout } = await run(
    process.execPath,
    [...(flags.args ?? []), driverPath, workerPath, marker, oomLimitMb],
    { env, timeout: 60_000 },
  );
  const overrideWarnings = stderr
    .split('\n')
    .filter((line) => line.includes('"file_parse.heap_budget_overridden"'))
    .map((line) => JSON.parse(line));
  return {
    marker,
    overrideWarnings,
    results: JSON.parse(stdout.trim().split('\n').pop()!) as any[],
  };
};

/**
 * A parent heap flag above the budget cannot be undone for a worker thread, and hosts such as
 * Vercel set one on the function process themselves. The parse runs with the parent's limit,
 * still on its own thread, and the override is logged once per runner.
 */
const expectRunsWithParentHeap = (
  outcome: Awaited<ReturnType<typeof spawnDriver>>,
  parentHeapMb: number,
) => {
  for (const result of outcome.results.slice(0, 2)) {
    expect(result.value).toBeGreaterThanOrEqual(parentHeapMb);
  }
  expect(existsSync(outcome.marker)).toBe(true);
  expect(outcome.results[2]).toEqual({ active: 0, queued: 0 });
  expect(outcome.overrideWarnings).toHaveLength(1);
  expect(outcome.overrideWarnings[0]).toMatchObject({ budgetMb: BUDGET_MB });
  expect(outcome.overrideWarnings[0].workerHeapMb).toBeGreaterThanOrEqual(parentHeapMb);
};

describe('parent V8 heap flags vs the worker memory budget', () => {
  it('runs with the configured heap when the parent sets no heap flag, and recovers from OOM', async () => {
    const { marker, overrideWarnings, results } = await spawnDriver({}, '64');

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
    expect(overrideWarnings).toEqual([]);
  }, 60_000);

  // Every form that gives the parent a larger old-space limit: CLI or NODE_OPTIONS, `-` or `_`.
  it.each([
    ['CLI --max-old-space-size', { args: ['--max-old-space-size=4096'] }],
    ['CLI --max_old_space_size', { args: ['--max_old_space_size=4096'] }],
    ['NODE_OPTIONS --max-old-space-size', { nodeOptions: '--max-old-space-size=4096' }],
    ['NODE_OPTIONS --max_old_space_size', { nodeOptions: '--max_old_space_size=4096' }],
    ['CLI --max-heap-size', { args: ['--max-heap-size=4096'] }],
  ])(
    'still parses, warning once, when the parent has %s above the budget',
    async (_, flags) => {
      expectRunsWithParentHeap(await spawnDriver(flags), 4096);
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
      const { marker, overrideWarnings, results } = await spawnDriver(flags);

      expect(results[0].value).toBeGreaterThanOrEqual(mb);
      expect(results[0].value).toBeLessThan(mb + 400);
      expect(results[1].value).toBe(results[0].value);
      expect(existsSync(marker)).toBe(true);
      expect(overrideWarnings).toEqual([]);
    },
    60_000,
  );

  // Node versions differ in which heap option forms they accept. An accepted form parses with the
  // parent's heap and warns once; otherwise Node must reject the specific option at startup,
  // rather than crash or time out.
  it.each([
    [
      'CLI --max-old-space-size (space-separated)',
      { args: ['--max-old-space-size', '4096'] },
      /bad option: --max-old-space-size(?:\s|$)/,
    ],
    [
      'NODE_OPTIONS --max-old-space-size (space-separated)',
      { nodeOptions: '--max-old-space-size 4096' },
      /bad option: --max-old-space-size(?:\s|$)/,
    ],
    [
      'NODE_OPTIONS --max-heap-size',
      { nodeOptions: '--max-heap-size=4096' },
      /--max-heap-size=? is not allowed in NODE_OPTIONS/,
    ],
  ])(
    'either parses with a warning or is rejected by Node for version-dependent option forms (%s)',
    async (_, flags, rejection) => {
      const outcome = await spawnDriver(flags).then(
        (value) => ({ value }),
        (error: { code?: number; signal?: string | null; stderr?: string }) => ({ error }),
      );

      if ('error' in outcome) {
        // Node rejected the flag itself: an actual option error, not a crash from something else.
        expect(outcome.error.code).toBe(9);
        expect(outcome.error.signal).toBeNull();
        expect(outcome.error.stderr).toMatch(rejection);
        return;
      }
      expectRunsWithParentHeap(outcome.value, 4096);
    },
    60_000,
  );
});
