import { type RetrieveMemoryParams } from '@/types/userMemory';

export const userMemoryCacheKey = (params: RetrieveMemoryParams): string => {
  const {
    categories,
    labels,
    layers,
    queries,
    relationships,
    status,
    tags,
    timeIntent,
    timeRange,
    topK,
    types,
  } = params;

  return JSON.stringify({
    categories: categories ?? null,
    labels: labels ?? null,
    layers: layers ?? null,
    queries: queries ?? null,
    relationships: relationships ?? null,
    status: status ?? null,
    tags: tags ?? null,
    timeIntent: timeIntent ?? null,
    timeRange: timeRange ?? null,
    topK: topK ?? null,
    types: types ?? null,
  });
};
