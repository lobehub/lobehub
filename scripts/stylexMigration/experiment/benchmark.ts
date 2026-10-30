import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';

import { captureInPage, compareSnapshots, mountFixture } from './capture';
import { openFixturePage } from './page';
import { serveProject } from './server';

const execute = promisify(execFile);
interface BenchmarkSample {
  captureMs: number;
  differences: number;
  diffMs: number;
  fixture: string;
  propertyReads: number;
}
interface BenchmarkCycle {
  cycle: number;
  domSnapshotSamples: Array<{
    bytes: number;
    durationMs: number;
    nodes: number;
    properties: number;
  }>;
  engine: string;
  launchMs: number;
  memory: Array<{ pid: number; ppid: number; rssKiB: number }>;
  samples: BenchmarkSample[];
  snapshots: Array<{ fixture: string; nodes: number[] }>;
  summedProcessRssMiB: number;
  version: string;
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const bounded = async <T>(promise: Promise<T>, stage: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Benchmark stage timed out: ${stage}`)),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout!);
  }
};

const main = async () => {
  const runDirectory = path.resolve(
    process.argv[2] ?? '.records/stylex-migration-experiment/pilot',
  );
  const server = await serveProject(runDirectory);
  const cycles: BenchmarkCycle[] = [];
  try {
    for (let cycle = 0; cycle < 3; cycle++)
      for (const engine of cycle % 2 ? ['shell', 'chrome'] : ['chrome', 'shell']) {
        const started = performance.now();
        const browser = await chromium.launch({
          executablePath:
            engine === 'chrome'
              ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
              : undefined,
          headless: true,
        });
        const launchMs = performance.now() - started;
        console.log(JSON.stringify({ cycle, engine, stage: 'launched' }));
        try {
          const pages = await Promise.all(
            ['before', 'after'].map((side) => openFixturePage(browser, server.url, side)),
          );
          const samples = [];
          console.log(JSON.stringify({ cycle, engine, stage: 'pages-ready' }));
          const snapshots = [];
          for (const fixture of ['galleyGrid', 'wideLiteTable', 'commandLine']) {
            console.log(JSON.stringify({ cycle, engine, fixture, stage: 'capture' }));
            await Promise.all(pages.map((page) => mountFixture(page, fixture)));
            console.log(JSON.stringify({ cycle, engine, fixture, stage: 'mounted' }));
            const warm = await bounded(
              Promise.all(pages.map((page) => page.evaluate(captureInPage, {}))),
              `${engine}:${fixture}:warm`,
            );
            for (let iteration = 0; iteration < 5; iteration++) {
              const started = performance.now();
              const trees = await bounded(
                Promise.all(pages.map((page) => page.evaluate(captureInPage, {}))),
                `${engine}:${fixture}:sample-${iteration}`,
              );
              const captureMs = performance.now() - started;
              const diffStarted = performance.now();
              const differences = compareSnapshots(trees[0], trees[1]);
              samples.push({
                captureMs,
                diffMs: performance.now() - diffStarted,
                differences: differences.length,
                fixture,
                propertyReads: trees.reduce((sum, tree) => sum + tree.propertyReads, 0),
              });
            }
            snapshots.push({ fixture, nodes: warm.map((tree) => tree.nodes.length) });
          }
          const cdp = await pages[0].context().newCDPSession(pages[0]);
          console.log(JSON.stringify({ cycle, engine, stage: 'dom-snapshot' }));
          const computedStyles = await pages[0].evaluate(() =>
            [...getComputedStyle(document.querySelector('[data-case-root]')!)].filter(
              (property) => !property.startsWith('--'),
            ),
          );
          const domSnapshotSamples = [];
          for (let iteration = 0; iteration < 3; iteration++) {
            const started = performance.now();
            const snapshot = await cdp.send('DOMSnapshot.captureSnapshot', {
              computedStyles,
              includeDOMRects: true,
            });
            domSnapshotSamples.push({
              bytes: JSON.stringify(snapshot).length,
              durationMs: performance.now() - started,
              nodes: snapshot.documents.reduce(
                (sum, doc) => sum + (doc.nodes.nodeName?.length ?? 0),
                0,
              ),
              properties: computedStyles.length,
            });
          }
          await cdp.detach();
          const session = await browser.newBrowserCDPSession();
          console.log(JSON.stringify({ cycle, engine, stage: 'memory' }));
          const processInfo = await session.send('SystemInfo.getProcessInfo');
          const pids = [...new Set(processInfo.processInfo.map((process) => process.id))];
          const ps = await execute('ps', ['-p', pids.join(','), '-o', 'pid=,ppid=,rss=']);
          const memory = ps.stdout
            .trim()
            .split('\n')
            .map((line) => {
              const [pid, ppid, rssKiB] = line.trim().split(/\s+/).map(Number);
              return { pid, ppid, rssKiB };
            });
          cycles.push({
            cycle,
            domSnapshotSamples,
            engine,
            launchMs,
            memory,
            samples,
            snapshots,
            summedProcessRssMiB: memory.reduce((sum, process) => sum + process.rssKiB, 0) / 1024,
            version: browser.version(),
          });
          console.log(
            JSON.stringify({
              cycle,
              engine,
              launchMs,
              captureMedianMs: median(samples.map((sample) => sample.captureMs)),
              rssMiB: cycles.at(-1)!.summedProcessRssMiB,
            }),
          );
        } catch (error) {
          console.error(String(error));
          throw error;
        } finally {
          await browser.close();
        }
      }
  } finally {
    await server.close();
  }
  const summary = ['chrome', 'shell'].map((engine) => {
    const selected = cycles.filter((cycle) => cycle.engine === engine);
    return {
      captureMedianMs: median(
        selected.flatMap((cycle) => cycle.samples.map((sample) => sample.captureMs)),
      ),
      engine,
      launchMedianMs: median(selected.map((cycle) => cycle.launchMs)),
      rssMedianMiB: median(selected.map((cycle) => cycle.summedProcessRssMiB)),
    };
  });
  const provenance = JSON.parse(await readFile(path.join(runDirectory, 'provenance.json'), 'utf8'));
  await writeFile(
    path.join(runDirectory, 'benchmark.json'),
    JSON.stringify({ cycles, provenance, runtime: process.version, summary }, null, 2),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
