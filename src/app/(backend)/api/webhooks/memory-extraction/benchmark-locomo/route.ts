import { memoryExtractionBenchmarkLoCoMoWebhookAPIHandler } from '@/server/api-runtime/memoryExtractionBenchmark';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const POST = createNextAPIRouteHandler(
  'api-webhooks-memory-extraction-benchmark-locomo',
  memoryExtractionBenchmarkLoCoMoWebhookAPIHandler,
);
