import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { captureInPage, compareSnapshots, mountFixture } from './capture';
import { fixtures } from './fixtures';
import { openFixturePage } from './page';
import { compareWithProbes, discoverProbes } from './probes';
import { buildProjects, prepareProject, repoRoot } from './project';
import { serveProject } from './server';

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

const main = async () => {
  const runDirectory = path.resolve(
    argument('--output') ??
      path.join(
        repoRoot,
        '.records/stylex-migration-experiment',
        new Date().toISOString().replaceAll(':', '-'),
      ),
  );
  await mkdir(runDirectory, { recursive: true });
  const metadataFile = path.join(runDirectory, 'provenance.json');
  let provenance: Awaited<ReturnType<typeof prepareProject>>;
  if (process.argv.includes('--reuse-build'))
    provenance = JSON.parse(await readFile(metadataFile, 'utf8'));
  else {
    provenance = await prepareProject(runDirectory);
    await writeFile(metadataFile, JSON.stringify(provenance, null, 2));
    console.log(
      'Preparing production fixture bundles',
      JSON.stringify({ runDirectory, preparationMs: provenance.preparationMs }),
    );
    const builds = await buildProjects(runDirectory, provenance.sources);
    await writeFile(path.join(runDirectory, 'builds.json'), JSON.stringify(builds, null, 2));
    console.log('Builds complete', JSON.stringify(builds));
  }
  if (process.argv.includes('--build-only')) return;
  const server = await serveProject(runDirectory);
  const engine = argument('--engine') ?? 'chrome';
  const backend = argument('--backend') === 'fast' ? 'fast' : 'strict';
  const outputPrefix = backend === 'fast' ? `${engine}-fast` : engine;
  const launched = performance.now();
  const browser = await chromium.launch({
    executablePath:
      argument('--browser') ??
      (engine === 'shell'
        ? undefined
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    headless: true,
  });
  const launchMs = performance.now() - launched;
  const runnerDirectory = path.join(repoRoot, 'scripts/stylexMigration/experiment');
  const runnerFiles = (await readdir(runnerDirectory))
    .filter((file) => /\.(?:ts|tsx)$/.test(file))
    .sort();
  const runnerHash = createHash('sha256');
  for (const file of runnerFiles)
    runnerHash.update(file).update(await readFile(path.join(runnerDirectory, file)));
  const runnerFingerprint = runnerHash.digest('hex');
  try {
    const pages = await Promise.all(
      ['before', 'after'].map(async (side) => {
        const page = await openFixturePage(browser, server.url, side);
        page.on('pageerror', (error) => console.error(side, error.message));
        return page;
      }),
    );
    const results = [];
    const runStarted = performance.now();
    for (const fixture of fixtures.filter(
      (fixture) => !argument('--fixture') || fixture.id === argument('--fixture'),
    )) {
      const started = performance.now();
      await Promise.all(pages.map((page) => mountFixture(page, fixture.id)));
      const plan = await discoverProbes(pages);
      const comparison = await compareWithProbes(pages, plan, backend);
      const repeated = await pages[0].evaluate(captureInPage, {});
      const repeatedAgain = await pages[0].evaluate(captureInPage, {});
      const aaDifferences = compareSnapshots(repeated, repeatedAgain);
      const differenceCount = comparison.results.reduce(
        (sum, result) => sum + result.differenceCount,
        0,
      );
      const result = {
        ...fixture,
        aaDifferences,
        coverage: comparison.coverage,
        differenceCount,
        durationMs: performance.now() - started,
        inventories: plan.inventories.map((inventory) => ({ ...inventory, cssText: undefined })),
        probePlan: plan.probes,
        results: comparison.results,
        snapshots: comparison.baseline,
        unsupported: plan.unsupported,
      };
      results.push(result);
      await writeFile(
        path.join(runDirectory, `${outputPrefix}-${fixture.id}.json`),
        JSON.stringify(result),
      );
      console.log(
        JSON.stringify({
          fixture: fixture.id,
          nodes: comparison.baseline.map((snapshot) => snapshot.nodes.length),
          differences: differenceCount,
          durationMs: result.durationMs,
          probes: plan.probes.length,
          unsupported: plan.unsupported.length,
          aa: aaDifferences.length,
        }),
      );
    }
    await writeFile(
      path.join(runDirectory, `${outputPrefix}-results.json`),
      JSON.stringify({
        browserVersion: browser.version(),
        backend,
        durationMs: performance.now() - runStarted,
        engine,
        generatedAt: new Date().toISOString(),
        launchMs,
        provenance,
        results,
        runnerFingerprint,
        runtime: process.version,
      }),
    );
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`Experiment data: ${runDirectory}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
