import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { captureInPage, compareSnapshots, mountFixture } from './capture';
import { createFastCapture } from './fastCapture';
import { fixtures } from './fixtures';
import { openFixturePage } from './page';
import { createProbeDriver, discoverProbes } from './probes';
import { serveProject } from './server';

const main = async () => {
  const output = path.resolve(process.argv[2] ?? '.records/stylex-migration-experiment/pilot');
  const server = await serveProject(output);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const side of ['before', 'after']) {
      const page = await openFixturePage(browser, server.url, side);
      for (const fixture of fixtures) {
        await mountFixture(page, fixture.id);
        const plan = await discoverProbes([page]);
        const driver = await createProbeDriver(page);
        const capture = await createFastCapture(page, driver.cdp);
        const properties = await page.evaluate(() =>
          [...getComputedStyle(document.querySelector('[data-case-root]')!)].filter(
            (property) => !property.startsWith('--'),
          ),
        );
        const probes = plan.probes
          .filter(
            (probe) => probe.id === 'default' || probe.containers || probe.animationTime === 450,
          )
          .slice(0, 9);
        try {
          for (const probe of probes) {
            await driver.apply(probe);
            const js = await page.evaluate(captureInPage, {
              animationTime: probe.animationTime,
              properties,
            });
            const cdp = await capture(probe.animationTime);
            const differences = compareSnapshots(js, cdp);
            results.push({
              differences,
              fixture: fixture.id,
              id: probe.id,
              nodes: js.nodes.length,
              side,
            });
          }
        } finally {
          await driver.dispose();
        }
      }
      await page.close();
    }
    await writeFile(
      path.join(output, 'backend-parity.json'),
      JSON.stringify(
        {
          browserVersion: browser.version(),
          results,
          runtime: process.version,
          summary: {
            comparisons: results.length,
            differences: results.reduce((sum, result) => sum + result.differences.length, 0),
            mismatching: results.filter((result) => result.differences.length).length,
          },
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        comparisons: results.length,
        mismatching: results.filter((result) => result.differences.length).length,
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
