/**
 * Generate the OpenAPI 3.1 spec (openapi.yml) from the live Hono app.
 *
 * The document itself is assembled by `src/spec.ts` (shared with the runtime
 * `GET /api/v1/openapi.json` endpoint). This script adds what the emitter
 * needs on top: safe env bootstrapping, a parity check that fails when a
 * registered route is missing from the spec (instead of silently vanishing),
 * and a `--check` mode for CI.
 *
 * Usage:
 *   bun scripts/generate-openapi.ts          # regenerate openapi.yml
 *   bun scripts/generate-openapi.ts --check  # verify openapi.yml is up to date (CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Safe defaults so importing the app never touches real infrastructure.
// NODE_ENV=test makes the database adaptor return a mock instance, and the
// dummy secrets satisfy import-time env validation in downstream packages.
// (NODE_ENV is typed read-only, hence Object.assign)
if (!process.env.NODE_ENV) Object.assign(process.env, { NODE_ENV: 'test' });
process.env.KEY_VAULTS_SECRET ??= 'openapi-spec-generation';
process.env.CLOUD_DATABASE_URL ??= 'postgresql://mock:mock@localhost:5432/mock';
process.env.QSTASH_TOKEN ??= 'mock-qstash-token';

const PKG_ROOT = path.join(import.meta.dirname, '..');
const SPEC_PATH = path.join(PKG_ROOT, 'openapi.yml');
const HTTP_METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);

// Documentation-serving routes: real endpoints, deliberately not part of the
// API surface described by the spec.
const SPEC_EXEMPT = new Set(['GET /api/v1/docs', 'GET /api/v1/openapi.json']);

// Import after the env defaults above are in place.
const { honoApp } = await import('../src/app');
const { buildSpecDocument } = await import('../src/spec');
const YAML = await import('yaml');

const spec = await buildSpecDocument(honoApp);
const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;

// ---------- Parity check: every registered route must be in the spec ----------
const normalize = (routePath: string) => routePath.replaceAll(/:([^/]+)/g, '{$1}');

const registered = new Set(
  honoApp.routes
    .filter((r) => HTTP_METHODS.has(r.method))
    .map((r) => `${r.method} ${normalize(r.path)}`)
    .filter((endpoint) => !SPEC_EXEMPT.has(endpoint)),
);
const documented = new Set(
  Object.entries(paths).flatMap(([specPath, item]) =>
    Object.keys(item)
      .filter((method) => HTTP_METHODS.has(method.toUpperCase()))
      .map((method) => `${method.toUpperCase()} ${specPath}`),
  ),
);

const missing = [...registered].filter((endpoint) => !documented.has(endpoint));
const extra = [...documented].filter((endpoint) => !registered.has(endpoint));

if (missing.length > 0 || extra.length > 0) {
  if (missing.length > 0) {
    console.error(
      `✗ ${missing.length} route(s) missing from the spec (no hono-openapi validator/describeRoute attached):`,
    );
    for (const endpoint of missing) console.error(`  - ${endpoint}`);
  }
  for (const endpoint of extra) console.error(`  ? documented but not registered: ${endpoint}`);
  process.exit(1);
}

// ---------- Emit ----------

// `spec.info.title` and `servers[].description` now come from the branding slot
// (`@lobechat/business-const`), which a white-label distribution overrides
// through pnpm. That makes this generated file brand-dependent: run from such a
// workspace it would write the distribution's product name into a tracked file
// and offer it up for commit.
//
// Refuse instead. The committed artifact must always be the upstream document —
// downstream builds get their branding from the RUNTIME `/api/v1/openapi.json`,
// which is rebuilt from the live routes on first request and never read from
// here. Nothing legitimate needs to regenerate this file under custom branding.
// Both modes have to bail out, for opposite reasons: writing would leak the
// product name into the tracked file, and `--check` would compare a branded
// document against the upstream one and report spurious drift forever.
const { isCustomBranding } = await import('@lobechat/const');

if (isCustomBranding) {
  if (process.argv.includes('--check')) {
    console.log('• openapi.yml drift check skipped: custom branding slot in this workspace.');
    process.exit(0);
  }
  console.error(
    '✗ refusing to write openapi.yml: this workspace resolves a custom branding slot,\n' +
      "  so the output would carry that distribution's product name into a tracked file.\n" +
      '  Regenerate from an unmodified checkout. The runtime /api/v1/openapi.json is\n' +
      '  built from the live routes and already reflects local branding.',
  );
  process.exit(1);
}

const output = YAML.stringify(spec, { aliasDuplicateObjects: false });

if (process.argv.includes('--check')) {
  const committed = readFileSync(SPEC_PATH, 'utf8');
  if (committed !== output) {
    console.error(
      '✗ openapi.yml is out of date with the routes. Run `bun generate:openapi` in packages/openapi and commit the result.',
    );
    process.exit(1);
  }
  console.log(`✓ openapi.yml is up to date (${documented.size} operations)`);
} else {
  writeFileSync(SPEC_PATH, output);
  console.log(
    `✓ openapi.yml written: ${documented.size} operations, ${Object.keys(paths).length} paths`,
  );
}

// The auth middleware registers a cache-cleanup interval at import time,
// which would otherwise keep the process alive.
process.exit(0);
