/**
 * Generate `src/generated/` (types + resource-style SDK) from the committed
 * OpenAPI spec (`packages/openapi/openapi.yml`) via @hey-api/openapi-ts.
 *
 * The generated output is committed so the published package never depends on
 * generation happening at install time, and `--check` keeps it from drifting
 * when routes change (same contract as `generate-openapi.ts --check`).
 *
 * Usage:
 *   bun scripts/generate-sdk.ts          # regenerate src/generated
 *   bun scripts/generate-sdk.ts --check  # verify src/generated is up to date
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createClient } from '@hey-api/openapi-ts';

import config from '../openapi-ts.config';

const PKG_ROOT = path.join(import.meta.dirname, '..');
const OUTPUT_DIR = path.join(PKG_ROOT, 'src', 'generated');

const listFiles = (dir: string, base = dir): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });

process.chdir(PKG_ROOT);

if (process.argv.includes('--check')) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'lobehub-sdk-check-'));
  try {
    await createClient({ ...config, logs: { level: 'silent' }, output: tempDir });

    const expected = listFiles(tempDir).sort();
    const committed = listFiles(OUTPUT_DIR).sort();
    const stale =
      expected.join('\n') !== committed.join('\n') ||
      expected.some(
        (file) =>
          readFileSync(path.join(tempDir, file), 'utf8') !==
          readFileSync(path.join(OUTPUT_DIR, file), 'utf8'),
      );

    if (stale) {
      console.error(
        '✗ src/generated is out of date with openapi.yml. Run `bun generate` in packages/sdk and commit the result.',
      );
      process.exit(1);
    }
    console.log('✓ src/generated is up to date with openapi.yml');
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
} else {
  rmSync(OUTPUT_DIR, { force: true, recursive: true });
  await createClient(config);
  console.log(`✓ Generated ${path.relative(PKG_ROOT, OUTPUT_DIR)} from openapi.yml`);
}
