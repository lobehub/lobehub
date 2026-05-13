import { memoryUserMemoryBenchmarkLoCoMoDevAPIHandler } from '@/server/api-runtime/memoryBenchmarkDev';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const POST = createNextAPIRouteHandler(
  'api-dev-memory-user-memory-benchmark-locomo',
  memoryUserMemoryBenchmarkLoCoMoDevAPIHandler,
);
