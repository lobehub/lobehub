/**
 * Generate the OpenAPI 3.1 spec (openapi.yml) from the live Hono app.
 *
 * The spec is assembled at runtime by hono-openapi: every route's request
 * schema is registered through `src/common/validator.ts`, and route metadata
 * comes from `describeRoute`. The script then post-processes the document
 * (tags / operationId / placeholder responses) and verifies that every
 * registered route made it into the spec, so a route that silently misses
 * spec registration fails the run instead of vanishing from the document.
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

// Import after the env defaults above are in place.
const { honoApp } = await import('../src/app');
const { generateSpecs } = await import('hono-openapi');
const YAML = await import('yaml');

const spec = await generateSpecs(honoApp, {
  documentation: {
    components: {
      securitySchemes: {
        bearerAuth: {
          bearerFormat: 'API Key (sk-lh-...) or OIDC JWT',
          scheme: 'bearer',
          type: 'http',
        },
      },
    },
    info: {
      description:
        'LobeHub platform REST API. Generated from `packages/openapi` routes — do not edit openapi.yml by hand; run `bun generate:openapi` instead.',
      title: 'LobeHub API',
      version: '1.0.0',
    },
    security: [{ bearerAuth: [] }],
    servers: [{ description: 'LobeHub Cloud', url: 'https://app.lobehub.com' }],
  },
});

// ---------- Post-processing ----------
type Operation = {
  operationId?: string;
  responses?: Record<string, unknown>;
  tags?: string[];
};

const paths = (spec.paths ?? {}) as Record<string, Record<string, Operation>>;

for (const [path, item] of Object.entries(paths)) {
  // '/api/v1/agent-groups/{id}' -> group 'agent-groups', rest '{id}'
  const segments = path.replace(/^\/api\/v1\/?/, '').split('/');
  const group = segments[0] || 'root';
  const rest = segments.slice(1).join('/');

  for (const [method, op] of Object.entries(item)) {
    if (!HTTP_METHODS.has(method.toUpperCase())) continue;

    op.tags ??= [group];
    op.operationId ??= `${group}.${method}${rest ? `_${rest.replaceAll(/[{}]/g, '').replaceAll('/', '_')}` : ''}`;
    // OpenAPI requires a responses object and a description on every response.
    // Response schemas are still pending (tracked in the spec rollout plan),
    // so fill placeholders where the routes have not declared them yet.
    if (!op.responses || Object.keys(op.responses).length === 0) {
      op.responses = { 200: { description: 'Successful response (schema pending)' } };
    }
    for (const response of Object.values(op.responses)) {
      const responseObject = response as { description?: string };
      responseObject.description ??= 'Successful response (schema pending)';
    }
  }
}

// ---------- Parity check: every registered route must be in the spec ----------
const normalize = (path: string) => path.replaceAll(/:([^/]+)/g, '{$1}');

const registered = new Set(
  honoApp.routes
    .filter((r) => HTTP_METHODS.has(r.method))
    .map((r) => `${r.method} ${normalize(r.path)}`),
);
const documented = new Set(
  Object.entries(paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((method) => HTTP_METHODS.has(method.toUpperCase()))
      .map((method) => `${method.toUpperCase()} ${path}`),
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
