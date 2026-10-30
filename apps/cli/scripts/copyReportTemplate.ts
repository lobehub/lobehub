import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ship the offline acceptance page next to the bundle: `lh acceptance run
 * render` reads `dist/acceptance-report.html` at runtime. The page is built by
 * apps/workbench (`build:report`). A local build without it still produces a
 * working CLI — only `run render` reports the page missing — but a release
 * passes `--require`, so a published CLI always carries it.
 */
const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(cliDir, '../workbench/dist-report/acceptance-report.html');
const target = path.join(cliDir, 'dist/acceptance-report.html');

if (fs.existsSync(source)) {
  fs.copyFileSync(source, target);
  console.info(`copied ${path.relative(cliDir, source)} → ${path.relative(cliDir, target)}`);
} else if (process.argv.includes('--require')) {
  console.error(`Missing ${source}. Build it first: bun run --cwd ../workbench build:report`);
  process.exit(1);
} else {
  console.warn(
    `Skipping the local report page (${path.relative(cliDir, source)} not built); \`lh acceptance run render\` will report it missing.`,
  );
}
