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
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createClient } from '@hey-api/openapi-ts';

import configThenable from '../openapi-ts.config';

// defineConfig returns a thenable — resolve it once so the object can be
// spread and passed to createClient with proper types.
const config = await configThenable;

const PKG_ROOT = path.join(import.meta.dirname, '..');
const OUTPUT_DIR = path.join(PKG_ROOT, 'src', 'generated');

const MERGE_METHOD_HEADERS_HELPER = `
const mergeMethodHeaders = (
    defaults: Record<string, unknown>,
    headers: Options['headers'],
): Record<string, unknown> => {
    const merged = { ...defaults };
    if (!headers) {
        return merged;
    }
    const entries = headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
    for (const [key, value] of entries) {
        merged[key] = value;
    }
    return merged;
};
`;

/**
 * hey-api 0.99's generated headers handling breaks on legal HeadersInit
 * shapes; rewrite the output in two places (applied identically in generate
 * and --check modes, so the byte-level comparison is unaffected):
 *
 * 1. `mergeHeaders` reads plain objects via `Object.entries`, which turns a
 *    tuple array (`[['X-Trace','1']]`) into numeric keys — normalize tuple
 *    arrays through `new Headers()` first. This covers client-level defaults
 *    and read-method per-call headers.
 * 2. Write methods merge caller headers with an object spread
 *    (`{ 'Content-Type': …, ...options.headers }`), which silently drops
 *    `Headers` instances and corrupts tuple arrays. Rewrite the spread to a
 *    helper that normalizes every HeadersInit shape into a PLAIN object —
 *    not a `Headers` — so the `'Content-Type': null` deletion sentinel on
 *    form-data methods survives until the client's final merge
 *    (`mergeHeaders(_config.headers, options.headers)`), where it must be
 *    able to delete a client-default Content-Type.
 */
const rewriteHeaderSpreads = (dir: string) => {
  const sdkPath = path.join(dir, 'sdk.gen.ts');
  const sdkSource = readFileSync(sdkPath, 'utf8');
  const importAnchor = "} from './types.gen';\n";
  const sdkRewritten = sdkSource
    .replaceAll(
      /headers: \{\s*'Content-Type': ('application\/json'|null),\s*\.\.\.options\.headers\s*\}/g,
      "headers: mergeMethodHeaders({ 'Content-Type': $1 }, options.headers)",
    )
    .replace(importAnchor, importAnchor + MERGE_METHOD_HEADERS_HELPER);
  if (sdkRewritten === sdkSource || !sdkRewritten.includes('mergeMethodHeaders(')) {
    throw new Error(
      'rewriteHeaderSpreads: expected generated header-spread pattern not found in sdk.gen.ts — check the generator output against the rewrite rules.',
    );
  }
  writeFileSync(sdkPath, sdkRewritten);

  const utilsPath = path.join(dir, 'client', 'utils.gen.ts');
  const utilsSource = readFileSync(utilsPath, 'utf8');
  const iteratorLine =
    'const iterator = header instanceof Headers ? headersEntries(header) : Object.entries(header);';
  const utilsRewritten = utilsSource.replace(
    iteratorLine,
    'const iterator = header instanceof Headers ? headersEntries(header) : Array.isArray(header) ? headersEntries(new Headers(header as Array<[string, string]>)) : Object.entries(header);',
  );
  if (utilsRewritten === utilsSource) {
    throw new Error(
      'rewriteHeaderSpreads: expected mergeHeaders iterator line not found in client/utils.gen.ts — check the generator output against the rewrite rules.',
    );
  }
  writeFileSync(utilsPath, utilsRewritten);
};

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
    rewriteHeaderSpreads(tempDir);

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
  rewriteHeaderSpreads(OUTPUT_DIR);
  console.log(`✓ Generated ${path.relative(PKG_ROOT, OUTPUT_DIR)} from openapi.yml`);
}
