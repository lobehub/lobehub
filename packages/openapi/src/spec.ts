import { API_KEY_PREFIX } from '@lobechat/utils/apiKey';
import { generateSpecs } from 'hono-openapi';
import { z } from 'zod';

import { ApiErrorSchema, errorResponse } from './common/openapi';

const HTTP_METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);

type GenerateSpecsApp = Parameters<typeof generateSpecs>[0];

interface OperationObject {
  operationId?: string;
  responses?: Record<string, { content?: unknown; description?: string }>;
  tags?: string[];
}

const {
  $schema: _,
  id: __,
  ...apiErrorJsonSchema
} = z.toJSONSchema(ApiErrorSchema) as Record<string, unknown>;

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
        schemas: { ApiError: apiErrorJsonSchema },
        securitySchemes: {
          bearerAuth: {
            bearerFormat: `API Key (${API_KEY_PREFIX}...) or OIDC JWT`,
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

      for (const response of Object.values(responses)) response.description ??= 'Response';
    }
  }

  return { spec, undocumented };
};
