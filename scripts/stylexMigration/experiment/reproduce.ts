import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { captureInPage, compareSnapshots, mountFixture } from './capture';
import { fixtures } from './fixtures';
import { openFixturePage } from './page';
import { compareWithProbes, discoverProbes } from './probes';
import { serveProject } from './server';

const main = async () => {
  const runDirectory = path.resolve(
    process.argv[2] ?? '.records/stylex-migration-experiment/pilot',
  );
  const server = await serveProject(runDirectory);
  const browser = await chromium.launch({ headless: true });
  try {
    const pages = await Promise.all(
      ['before', 'after', 'before'].map((side) => openFixturePage(browser, server.url, side)),
    );
    const independentControls = [];
    for (const fixture of fixtures) {
      const pair = [pages[0], pages[2]];
      await Promise.all(pair.map((page) => mountFixture(page, fixture.id)));
      const snapshots = await Promise.all(pair.map((page) => page.evaluate(captureInPage, {})));
      independentControls.push({
        differences: compareSnapshots(snapshots[0], snapshots[1]),
        fixture: fixture.id,
        nodes: snapshots.map((snapshot) => snapshot.nodes.length),
      });
    }
    const pair = pages.slice(0, 2);
    await Promise.all(pair.map((page) => mountFixture(page, 'wideLiteTable')));
    const plan = await discoverProbes(pair);
    const rowIndex = await pages[0].evaluate(() =>
      Number(document.querySelector('tbody tr')!.getAttribute('data-experiment-node')),
    );
    const containerIndex = plan.probes.find((probe) => probe.containers)!.containers![0].index;
    plan.probes = [
      { id: 'default' },
      ...[600, 601, 799, 800, 801].map((width) => ({
        containers: [{ index: containerIndex, width }],
        id: `container-${width}`,
      })),
      {
        containers: [{ index: containerIndex, width: 799 }],
        forced: { index: rowIndex, states: ['hover'] },
        id: 'container-799-hover-row',
      },
    ];
    const original = await compareWithProbes(pair, plan);
    // Experimental, in-memory override only. No PR or production component is changed.
    const css = await pages[1].evaluate(() => {
      const wide = [...document.querySelector('table')!.classList].find((name) =>
        name.includes('wideList'),
      )!;
      if (!wide) throw new Error('The wideList class is missing');
      const selector = `.${CSS.escape(wide)}.${CSS.escape(wide)}`;
      const css = `@container (max-width:800px){${selector}{min-width:0}${selector} td{padding-block:6px}${selector} td[data-list-slot='title'],${selector} td[data-list-slot='extra']{padding-block:8px}${selector} tbody tr:hover{background:transparent}}`;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      return css;
    });
    const corrected = await compareWithProbes(pair, plan);
    const summarize = (comparison: typeof original) =>
      comparison.results.map((result) => ({
        ...result,
        renderingDifferences: result.differences.filter(
          (difference) => !difference.diagnosticReason,
        ),
      }));
    const result = {
      browserVersion: browser.version(),
      corrected: summarize(corrected),
      experimentalOverrideCss: css,
      independentControls,
      original: summarize(original),
      probes: plan.probes,
    };
    await writeFile(path.join(runDirectory, 'reproduction.json'), JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({
        aaFixtures: independentControls.length,
        aaDifferences: independentControls.reduce(
          (sum, result) => sum + result.differences.length,
          0,
        ),
        originalRenderingDifferences: result.original.map((probe) => [
          probe.id,
          probe.renderingDifferences.length,
        ]),
        correctedRenderingDifferences: result.corrected.map((probe) => [
          probe.id,
          probe.renderingDifferences.length,
        ]),
      }),
    );
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
