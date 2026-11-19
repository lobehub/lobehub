import { API_KEY_PREFIX } from '@lobechat/utils/apiKey';
import { generateSpecs } from 'hono-openapi';
import { z } from 'zod';

import { API_ERROR_CODES, ApiErrorCodeSchema } from './common/errors';
import { ApiErrorSchema, errorResponse } from './common/openapi';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './helpers/pagination';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAYED_HEADER } from './middleware/idempotency';
import { RATE_LIMIT_HEADERS } from './middleware/rate-limit';
import { REQUEST_ID_HEADER } from './middleware/request-id';

const HTTP_METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);

type GenerateSpecsApp = Parameters<typeof generateSpecs>[0];

interface ParameterObject {
  $ref?: string;
  deprecated?: boolean;
  in?: string;
  name?: string;
  schema?: { deprecated?: boolean };
}

interface ResponseObject {
  content?: unknown;
  description?: string;
  headers?: Record<string, unknown>;
}

interface OperationObject {
  operationId?: string;
  parameters?: ParameterObject[];
  responses?: Record<string, ResponseObject>;
  security?: unknown[];
  tags?: string[];
}

const toComponentSchema = (schema: z.ZodType) => {
  const { $schema: _, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
};

const errorCodeCatalogue = Object.entries(API_ERROR_CODES)
  .map(([code, { description }]) => `- \`${code}\`: ${description}`)
  .join('\n');

const apiErrorCodeJsonSchema = {
  ...toComponentSchema(ApiErrorCodeSchema),
  description: `Stable machine-readable error code. Codes are only ever added.\n\n${errorCodeCatalogue}`,
};

const apiErrorJsonSchema = (() => {
  const json = toComponentSchema(ApiErrorSchema) as {
    properties: Record<string, Record<string, unknown>>;
  };
  json.properties.code = { $ref: '#/components/schemas/ApiErrorCode' };
  json.properties.error = {
    description: 'Deprecated alias of `message`, kept for clients written before `code`.',
    type: 'string',
  };
  json.properties.requestId = {
    description: `Same value as the \`${REQUEST_ID_HEADER}\` response header; quote it when reporting an issue.`,
    type: 'string',
  };
  return json;
})();

const headerRef = (name: string) => ({ $ref: `#/components/headers/${name}` });

const RATE_LIMIT_RESPONSE_HEADERS = {
  [RATE_LIMIT_HEADERS.limit]: headerRef('RateLimitLimit'),
  [RATE_LIMIT_HEADERS.remaining]: headerRef('RateLimitRemaining'),
  [RATE_LIMIT_HEADERS.reset]: headerRef('RateLimitReset'),
};

const integerHeader = (description: string) => ({
  description,
  schema: { type: 'integer' as const },
});

const SHARED_HEADERS = {
  IdempotentReplayed: {
    description: `\`true\` when this response was replayed from the first request sent with the same \`${IDEMPOTENCY_KEY_HEADER}\`.`,
    schema: { enum: ['true'], type: 'string' as const },
  },
  RateLimitLimit: integerHeader('Requests this API key may send per window.'),
  RateLimitRemaining: integerHeader('Requests left in the current window.'),
  RateLimitReset: integerHeader('Unix time (seconds) the current window resets.'),
  RequestId: {
    description:
      'Unique id of this request, also returned as `requestId` in error bodies. A client-supplied `X-Request-Id` (≤128 chars of `[A-Za-z0-9_.:-]`) is echoed back.',
    schema: { type: 'string' as const },
  },
  RetryAfter: integerHeader('Seconds to wait before retrying.'),
};

const IDEMPOTENCY_KEY_PARAMETER = {
  description: `Makes the request safe to retry: the first request with a key runs, and repeats with the same key and the same request within 24 hours get its stored response back (with \`${IDEMPOTENT_REPLAYED_HEADER}: true\`). A repeat while the first is still running answers 409, and reusing a key for a different request (method, path or body) answers 422 (both \`idempotency_conflict\`). Server errors, 429s and streamed responses are not stored. Keys are scoped to the authenticated user, the credential (API key) and the resolved workspace. A request still running after 5 minutes releases its in-flight claim, after which a retry with the same key runs again.`,
  in: 'header',
  name: IDEMPOTENCY_KEY_HEADER,
  required: false,
  schema: { maxLength: 255, minLength: 1, type: 'string' as const },
};

const API_DESCRIPTION = `LobeHub platform REST API. Generated from \`packages/openapi\` routes — do not edit openapi.yml by hand; run \`bun generate:openapi\` instead.

## Errors

Every error answers with the \`ApiError\` body: \`{ success: false, code, message, details?, requestId, timestamp, error }\`. Branch on \`code\` (see \`ApiErrorCode\`), not on \`message\`. Validation failures use \`validation_error\` and list each failing field in \`details\` as \`{ path, message }\`, where \`path\` is dotted and starts with the request part (\`json\`, \`query\`, \`param\`, \`header\`). \`error\` is a deprecated alias of \`message\`. The OpenResponses route (\`POST /api/v1/responses\`) keeps the protocol's \`{ error: { type, message, code, param } }\` body, plus \`requestId\`.

Every response carries an \`${REQUEST_ID_HEADER}\` header.

## Pagination

List endpoints take \`limit\` (1–${MAX_PAGE_LIMIT}, default ${DEFAULT_PAGE_LIMIT}) and an opaque \`cursor\`, and answer \`{ data: { <items>, total?, hasMore, nextCursor } }\`: pass \`nextCursor\` as \`cursor\` to read the next page; it is \`null\` on the last page. New endpoints name the item array \`items\`; older ones keep their own key (e.g. \`agents\`). The older \`page\`/\`pageSize\` and \`offset\` parameters still work but are deprecated.

## Rate limits

Requests authenticated with an API key are limited per key (default 600 per minute). Responses carry \`${RATE_LIMIT_HEADERS.limit}\`, \`${RATE_LIMIT_HEADERS.remaining}\` and \`${RATE_LIMIT_HEADERS.reset}\` (Unix seconds); a refused request answers 429 \`rate_limited\` with \`${RATE_LIMIT_HEADERS.retryAfter}\` in seconds.

## Idempotency

\`POST\` operations accept an \`${IDEMPOTENCY_KEY_HEADER}\` header; see the parameter description.`;

/**
 * Build the OpenAPI 3.1 document from the live Hono app.
 *
 * Shared by the runtime `GET /api/v1/openapi.json` endpoint (see `app.ts`)
 * and the `scripts/generate-openapi.ts` emitter, so the served spec and the
 * committed `openapi.yml` always come from the same logic.
 *
 * Every response — success status, payload schema and error codes — comes from
 * the route's own `routeDoc()` declaration. Nothing is inferred from the path:
 * an operation that does not declare a typed success response fails the build
 * instead of being documented with a guessed or open-ended shape.
 */
export const buildSpecDocument = async (app: GenerateSpecsApp) => {
  const { spec, undocumented } = await collectSpecDocument(app);

  if (undocumented.length > 0) {
    throw new Error(
      `Routes without a declared success response (attach routeDoc() from src/common/openapi.ts):\n${undocumented.map((op) => `  - ${op}`).join('\n')}`,
    );
  }

  return spec;
};

/**
 * The document plus every operation that lacks a typed success response.
 * `buildSpecDocument` refuses to emit a document with any; tests and tooling
 * use this to report them.
 */
export const collectSpecDocument = async (app: GenerateSpecsApp) => {
  const spec = await generateSpecs(app, {
    // Routes with a request validator can answer 400 through `zValidator`,
    // which uses the shared error envelope.
    defaultValidationErrorResponse: errorResponse(400),
    documentation: {
      components: {
        headers: SHARED_HEADERS,
        parameters: { IdempotencyKey: IDEMPOTENCY_KEY_PARAMETER },
        schemas: { ApiError: apiErrorJsonSchema, ApiErrorCode: apiErrorCodeJsonSchema },
        securitySchemes: {
          bearerAuth: {
            bearerFormat: `API Key (${API_KEY_PREFIX}...) or OIDC JWT`,
            scheme: 'bearer',
            type: 'http',
          },
        },
      },
      info: {
        description: API_DESCRIPTION,
        title: 'LobeHub API',
        version: '1.0.0',
      },
      security: [{ bearerAuth: [] }],
      servers: [{ description: 'LobeHub Cloud', url: 'https://app.lobehub.com' }],
    },
  });

  const paths = (spec.paths ?? {}) as Record<string, Record<string, OperationObject>>;
  const undocumented: string[] = [];

  for (const [path, item] of Object.entries(paths)) {
    // '/api/v1/agent-groups/{id}' -> group 'agent-groups', rest '{id}'
    const segments = path.replace(/^\/api\/v1\/?/, '').split('/');
    const group = segments[0] || 'root';
    const rest = segments.slice(1).join('/');

    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toUpperCase())) continue;

      op.tags ??= [group];
      op.operationId ??= `${group}.${method}${rest ? `_${rest.replaceAll(/[{}]/g, '').replaceAll('/', '_')}` : ''}`;

      const responses = op.responses ?? {};
      const hasTypedSuccess = Object.entries(responses).some(
        ([status, response]) => status.startsWith('2') && response.content,
      );
      if (!hasTypedSuccess) undocumented.push(`${method.toUpperCase()} ${path}`);

      // Public operations (health) opt out of auth with `security: []`; only
      // authenticated ones are rate limited and accept an Idempotency-Key.
      const authenticated = !(Array.isArray(op.security) && op.security.length === 0);

      for (const parameter of op.parameters ?? []) {
        if (parameter.schema?.deprecated) parameter.deprecated = true;
      }
      if (authenticated && method === 'post') {
        op.parameters = [
          ...(op.parameters ?? []),
          { $ref: '#/components/parameters/IdempotencyKey' },
        ];
      }

      for (const [status, response] of Object.entries(responses)) {
        response.description ??= 'Response';
        response.headers = {
          ...response.headers,
          [REQUEST_ID_HEADER]: headerRef('RequestId'),
          ...(authenticated ? RATE_LIMIT_RESPONSE_HEADERS : {}),
          ...(status === '429' ? { [RATE_LIMIT_HEADERS.retryAfter]: headerRef('RetryAfter') } : {}),
          ...(authenticated && method === 'post' && status.startsWith('2')
            ? { [IDEMPOTENT_REPLAYED_HEADER]: headerRef('IdempotentReplayed') }
            : {}),
        };
      }
    }
  }

  return { spec, undocumented };
};
