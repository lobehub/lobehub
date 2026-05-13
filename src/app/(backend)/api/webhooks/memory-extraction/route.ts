import { memoryExtractionWebhookAPIHandler } from '@/server/api-runtime/memoryExtraction';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const POST = createNextAPIRouteHandler(
  'api-webhooks-memory-extraction',
  memoryExtractionWebhookAPIHandler,
);
