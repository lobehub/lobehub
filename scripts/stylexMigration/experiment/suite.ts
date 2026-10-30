import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { runBoundaryMatrix, runHappyDomMatrix } from './matrix';

const main = async () => {
  const output = path.resolve(process.argv[2] ?? '.records/stylex-migration-experiment/boundaries');
  const watchdog = setTimeout(() => {
    console.error('Boundary suite exceeded 45 seconds');
    process.exit(124);
  }, 45_000);
  watchdog.unref();
  const backend = process.argv.includes('--fast') ? 'fast' : 'strict';
  await mkdir(output, { recursive: true });
  const happyDom = runHappyDomMatrix();
  await writeFile(path.join(output, 'happy-dom.json'), JSON.stringify(happyDom, null, 2));
  console.log('happy-dom', JSON.stringify(happyDom.summary));
  for (const engine of ['chrome', 'shell'] as const) {
    if (process.argv[3] && engine !== process.argv[3]) continue;
    const launched = performance.now();
    const browser = await chromium.launch({
      executablePath:
        engine === 'chrome'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : undefined,
      headless: true,
    });
    const launchMs = performance.now() - launched;
    try {
      const result = {
        engine,
        launchMs,
        version: browser.version(),
        ...(await runBoundaryMatrix(
          browser,
          process.argv[4] === '--fast' ? undefined : process.argv[4],
          backend,
        )),
      };
      await writeFile(path.join(output, `${engine}.json`), JSON.stringify(result, null, 2));
      console.log(
        engine,
        JSON.stringify(result.summary),
        `duration=${result.durationMs.toFixed(1)}ms`,
      );
    } finally {
      await browser.close();
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
