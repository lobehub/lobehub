import { type RetrieveMemoryParams } from '@/types/userMemory';

export const userMemoryCacheKey = (params: RetrieveMemoryParams): string => {
  const { query, topK } = params;

  return JSON.stringify({
    query,
    topK: topK ?? null,
  });
};
