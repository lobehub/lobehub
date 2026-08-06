import { generateSpecs } from 'hono-openapi';

const HTTP_METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);

type GenerateSpecsApp = Parameters<typeof generateSpecs>[0];

interface OperationObject {
  operationId?: string;
  responses?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Build the OpenAPI 3.1 document from the live Hono app.
 *
 * Shared by the runtime `GET /api/v1/openapi.json` endpoint (see `app.ts`)
 * and the `scripts/generate-openapi.ts` emitter, so the served spec and the
 * committed `openapi.yml` always come from the same logic.
 */
export const buildSpecDocument = async (app: GenerateSpecsApp) => {
  const spec = await generateSpecs(app, {
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

  const paths = (spec.paths ?? {}) as Record<string, Record<string, OperationObject>>;

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

  return spec;
};
