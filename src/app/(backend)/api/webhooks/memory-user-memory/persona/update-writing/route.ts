import { memoryUserPersonaUpdateWritingWebhookAPIHandler } from '@/server/api-runtime/memoryExtraction';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const POST = createNextAPIRouteHandler(
  'api-webhooks-memory-user-persona-update-writing',
  memoryUserPersonaUpdateWritingWebhookAPIHandler,
);
