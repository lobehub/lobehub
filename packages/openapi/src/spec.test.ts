import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { routeDoc } from './common/openapi';
import { buildSpecDocument, collectSpecDocument } from './spec';

type Schema = Record<string, unknown>;
type Spec = Awaited<ReturnType<typeof buildSpecDocument>>;

/**
 * Success responses allowed to stay open-ended, keyed `METHOD path` with the
 * reason. Empty on purpose: every operation declares a concrete payload. Add an
 * entry only for a payload whose keys are genuinely owned by the caller, and
 * say why in the value.
 */
const OPEN_RESPONSE_ALLOWLIST: Record<string, string> = {};

const HTTP_METHODS = new Set(['delete', 'get', 'patch', 'post', 'put']);

const loadAppSpec = async (): Promise<Spec> => {
  // Same safe defaults as `scripts/generate-openapi.ts`: importing the app must
  // not reach real infrastructure.
  process.env.KEY_VAULTS_SECRET ??= 'openapi-spec-test';
  process.env.CLOUD_DATABASE_URL ??= 'postgresql://mock:mock@localhost:5432/mock';
  process.env.QSTASH_TOKEN ??= 'mock-qstash-token';
  const { honoApp } = await import('./app');
  return buildSpecDocument(honoApp);
};

const resolveRef = (spec: Spec, schema: Schema): Schema => {
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  const name = ref.replace('#/components/schemas/', '');
  return (spec.components?.schemas?.[name] ?? {}) as Schema;
};

/** A schema that says nothing about its keys: `{}` / `additionalProperties` with no properties. */
const isOpaque = (schema: Schema) => {
  const keys = Object.keys(schema).filter((key) => key !== 'description');
  if (keys.length === 0) return true;
  if (schema.properties) return false;
  return (
    schema.additionalProperties === true ||
    (typeof schema.additionalProperties === 'object' &&
      Object.keys(schema.additionalProperties as Schema).length === 0 &&
      !schema.anyOf &&
      !schema.oneOf)
  );
};

/** Every location under `schema` that admits arbitrary undeclared keys (`additionalProperties: true`). */
const findOpenNodes = (spec: Spec, schema: Schema, at: string, seen = new Set<string>()) => {
  const found: string[] = [];
  const visit = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    const current = node as Schema;
    if (typeof current.$ref === 'string') {
      if (seen.has(current.$ref)) return;
      seen.add(current.$ref);
      visit(resolveRef(spec, current), `${path}→${current.$ref.split('/').pop()}`);
      return;
    }
    if (current.additionalProperties === true) found.push(path);
    for (const [key, value] of Object.entries(current)) {
      if (Array.isArray(value))
        value.forEach((item, index) => visit(item, `${path}.${key}[${index}]`));
      else if (value && typeof value === 'object') visit(value, `${path}.${key}`);
    }
  };
  visit(schema, at);
  return found;
};

/** The payload a client reads: `data` of the success envelope, or the whole body. */
const payloadOf = (spec: Spec, body: Schema): Schema => {
  const resolved = resolveRef(spec, body);
  const properties = resolved.properties as Record<string, Schema> | undefined;
  return properties?.success && properties.data ? resolveRef(spec, properties.data) : resolved;
};

const successResponses = (spec: Spec) =>
  Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
    Object.entries(item as Record<string, { responses?: Record<string, any> }>)
      .filter(([method]) => HTTP_METHODS.has(method))
      .flatMap(([method, op]) =>
        Object.entries(op.responses ?? {})
          .filter(([status]) => status.startsWith('2'))
          .map(([status, response]) => ({
            binary: Object.entries(response.content ?? {}).some(
              ([media, body]: [string, any]) =>
                media !== 'application/json' && body?.schema?.format === 'binary',
            ),
            key: `${method.toUpperCase()} ${path}`,
            schema: response.content?.['application/json']?.schema as Schema | undefined,
            status,
          })),
      ),
  );

describe('generated OpenAPI document', () => {
  let spec: Spec;

  beforeAll(async () => {
    spec = await loadAppSpec();
  }, 60_000);

  // Binary bodies (synthesized audio) are the one non-JSON success shape.
  it('gives every operation a JSON or binary success response', () => {
    const missing = successResponses(spec)
      .filter(({ binary, schema }) => !schema && !binary)
      .map(({ key }) => key);
    expect(missing).toEqual([]);
  });

  it('declares no open-ended success payloads outside the allowlist', () => {
    const violations = successResponses(spec)
      .filter(({ key }) => !(key in OPEN_RESPONSE_ALLOWLIST))
      .flatMap(({ key, schema, status }) => {
        if (!schema) return [];
        const payload = payloadOf(spec, schema);
        const items = payload.type === 'array' ? resolveRef(spec, payload.items as Schema) : null;
        const opaqueRoot = isOpaque(payload) || (items && isOpaque(items));
        return [
          ...(opaqueRoot ? [`${key} ${status}: payload is opaque`] : []),
          ...findOpenNodes(spec, schema, `${key} ${status}`).map(
            (at) => `${at}: additionalProperties: true`,
          ),
        ];
      });

    expect(violations).toEqual([]);
  });

  it('keeps the allowlist free of stale entries', () => {
    const operations = new Set(successResponses(spec).map(({ key }) => key));
    expect(Object.keys(OPEN_RESPONSE_ALLOWLIST).filter((key) => !operations.has(key))).toEqual([]);
  });

  // A `$defs` ref (what `z.toJSONSchema` emits for a schema carrying a meta id)
  // is unresolvable for the SDK generator, which crashes on it.
  it('references components only, never local $defs', () => {
    expect(JSON.stringify(spec)).not.toContain('#/$defs/');
  });

  it('publishes ApiError with a stable code catalogue and requestId', () => {
    const schemas = spec.components?.schemas as Record<string, Schema>;
    const apiError = schemas.ApiError as { properties: Record<string, Schema>; required: string[] };

    expect(apiError.required).toEqual(
      expect.arrayContaining(['code', 'error', 'message', 'requestId', 'success', 'timestamp']),
    );
    expect(apiError.properties.code).toEqual({ $ref: '#/components/schemas/ApiErrorCode' });
    expect(apiError.properties.details).toBeDefined();
    expect(schemas.ApiErrorCode.enum).toEqual(
      expect.arrayContaining([
        'validation_error',
        'unauthorized',
        'forbidden',
        'not_found',
        'conflict',
        'rate_limited',
        'workspace_mismatch',
        'insufficient_scope',
        'internal_error',
        'idempotency_conflict',
      ]),
    );
  });

  const operations = () =>
    Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
      Object.entries(item as Record<string, any>)
        .filter(([method]) => HTTP_METHODS.has(method))
        .map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, method, op })),
    );

  it('documents X-Request-Id on every response', () => {
    const missing = operations().flatMap(({ key, op }) =>
      Object.entries(op.responses as Record<string, { headers?: Schema }>)
        .filter(([, response]) => !response.headers?.['X-Request-Id'])
        .map(([status]) => `${key} ${status}`),
    );
    expect(missing).toEqual([]);
  });

  it('declares Idempotency-Key on every authenticated POST and nowhere else', () => {
    const declares = (op: any) =>
      (op.parameters ?? []).some(
        (parameter: Schema) => parameter.$ref === '#/components/parameters/IdempotencyKey',
      );
    const posts = operations().filter(({ method }) => method === 'post');
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.filter(({ op }) => !declares(op)).map(({ key }) => key)).toEqual([]);
    expect(
      operations()
        .filter(({ method, op }) => method !== 'post' && declares(op))
        .map(({ key }) => key),
    ).toEqual([]);
  });

  it('pairs every 429 with Retry-After and the rate-limit headers', () => {
    const limited = operations().filter(({ op }) => op.responses['429']);
    expect(limited.length).toBeGreaterThan(0);
    for (const { op } of limited) {
      expect(Object.keys(op.responses['429'].headers)).toEqual(
        expect.arrayContaining([
          'Retry-After',
          'X-RateLimit-Limit',
          'X-RateLimit-Remaining',
          'X-RateLimit-Reset',
        ]),
      );
    }
  });

  it('keeps the public health check out of rate limiting', () => {
    const health = (spec.paths as Record<string, any>)['/api/v1/health'].get;
    expect(health.security).toEqual([]);
    expect(health.responses['429']).toBeUndefined();
    expect(health.responses['200'].headers['X-RateLimit-Limit']).toBeUndefined();
  });

  it('marks the legacy page/pageSize/offset query parameters deprecated', () => {
    const legacy = operations().flatMap(({ key, op }) =>
      (op.parameters ?? [])
        .filter(
          (parameter: Schema) =>
            parameter.in === 'query' &&
            ['offset', 'page', 'pageSize'].includes(parameter.name as string),
        )
        .map((parameter: Schema) => ({
          deprecated: parameter.deprecated,
          key,
          name: parameter.name,
        })),
    );
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.filter(({ deprecated }) => !deprecated)).toEqual([]);
  });

  it('shapes every list through the shared page components', () => {
    const lists = [
      '/api/v1/agents',
      '/api/v1/agent-groups',
      '/api/v1/api-keys',
      '/api/v1/mcp-servers',
      '/api/v1/tasks',
      '/api/v1/topics',
    ];
    for (const path of lists) {
      const body = (spec.paths as Record<string, any>)[path].get.responses['200'].content[
        'application/json'
      ].schema;
      const data = payloadOf(spec, body).properties as Record<string, Schema>;
      expect({
        path,
        hasMore: data.hasMore,
        nextCursor: data.nextCursor,
        total: data.total,
      }).toEqual({
        hasMore: { $ref: '#/components/schemas/PageHasMore' },
        nextCursor: { $ref: '#/components/schemas/PageNextCursor' },
        path,
        total: { $ref: '#/components/schemas/PageTotal' },
      });
    }
  });

  it('keeps the OpenResponses error shape on POST /responses', () => {
    const op = (spec.paths as Record<string, any>)['/api/v1/responses'].post;
    const schema = op.responses['400'].content['application/json'].schema;
    expect(JSON.stringify(schema)).not.toContain('#/components/schemas/ApiError"');
    expect(Object.keys(resolveRef(spec, schema).properties as Schema)).toEqual(
      expect.arrayContaining(['error', 'requestId']),
    );
  });
});

describe('route-declared responses', () => {
  const buildApp = () => {
    const app = new Hono();
    app.post(
      '/api/v1/things',
      routeDoc({ data: z.object({ id: z.string() }), status: 201, summary: 'Create a thing' }),
      (c) => c.json({}, 201),
    );
    app.post(
      '/api/v1/things/:id/runs',
      routeDoc({
        data: z.object({ runId: z.string() }),
        errors: [404, 409],
        status: 202,
        summary: 'Run a thing',
      }),
      (c) => c.json({}, 202),
    );
    return app;
  };

  it('documents the declared success status and nothing else', async () => {
    const spec = await buildSpecDocument(buildApp());
    const created = (spec.paths?.['/api/v1/things'] as any).post.responses;
    const accepted = (spec.paths?.['/api/v1/things/{id}/runs'] as any).post.responses;

    expect(Object.keys(created)).toEqual(['201', '401', '403', '429', '500']);
    expect(Object.keys(accepted)).toEqual(['202', '401', '403', '404', '409', '429', '500']);
    expect(created['201'].content['application/json'].schema.properties.data).toMatchObject({
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
  });

  it('refuses to emit a route without a declared success response', async () => {
    const app = buildApp();
    app.get('/api/v1/vague', describeRoute({ summary: 'Vague' }), (c) => c.json({}));

    const { undocumented } = await collectSpecDocument(app);
    expect(undocumented).toEqual(['GET /api/v1/vague']);
    await expect(buildSpecDocument(app)).rejects.toThrow('GET /api/v1/vague');
  });
});
