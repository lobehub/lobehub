import { memoryExtractChatTopicCancelWebhookAPIHandler } from '@/server/api-runtime/memoryExtraction';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const POST = createNextAPIRouteHandler(
  'api-webhooks-memory-extract-chat-topic-cancel',
  memoryExtractChatTopicCancelWebhookAPIHandler,
);
