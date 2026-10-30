import type { FalJsonSchema } from './schema';

/**
 * Queue OpenAPI document shaped like the ones fal publishes: the submit operation is
 * `POST /<endpoint id>` with its input schema under `components.schemas`.
 */
export const buildFalOpenAPI = (endpointId: string, properties: Record<string, FalJsonSchema>) => ({
  components: {
    schemas: {
      Input: { properties, required: ['prompt'], type: 'object' },
      QueueStatus: { properties: { status: { type: 'string' } }, type: 'object' },
    },
  },
  openapi: '3.0.4',
  paths: {
    [`/${endpointId}`]: {
      post: {
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' } } },
        },
      },
    },
    [`/${endpointId}/requests/{request_id}/cancel`]: { put: {} },
  },
});

/** `GET /v1/models` response for one endpoint with an expanded OpenAPI schema */
export const buildFalCatalogResponse = (
  endpointId: string,
  properties: Record<string, FalJsonSchema>,
  metadata: Record<string, unknown> = {},
) => ({
  has_more: false,
  models: [
    {
      endpoint_id: endpointId,
      metadata: { display_name: endpointId, ...metadata },
      openapi: buildFalOpenAPI(endpointId, properties),
    },
  ],
  next_cursor: null,
});
