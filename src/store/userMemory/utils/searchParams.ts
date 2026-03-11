import { find, isString, trim } from 'es-toolkit/compat';

import { DEFAULT_SEARCH_USER_MEMORY_TOP_K } from '@/const/userMemory';
import { type RetrieveMemoryParams } from '@/types/userMemory';

interface MemorySearchSource {
  agent?: {
    description?: string | null;
    title?: string | null;
  } | null;
  latestUserMessage?: string | null;
  sendingMessage?: string | null;
  topic?: {
    historySummary?: string | null;
    title?: string | null;
  } | null;
}

const pickFirstNonEmpty = (values: Array<string | null | undefined>) => {
  const matched = find(values, (value) => isString(value) && trim(value).length > 0);

  if (!isString(matched)) return undefined;

  return trim(matched);
};

export const createMemorySearchParams = (
  source: MemorySearchSource,
): RetrieveMemoryParams | undefined => {
  const query = pickFirstNonEmpty([
    source.topic?.historySummary,
    source.agent?.description,
    source.latestUserMessage,
    source.sendingMessage,
  ]);

  if (!query) return undefined;

  return {
    query,
    topK: {
      ...DEFAULT_SEARCH_USER_MEMORY_TOP_K,
    },
  } as RetrieveMemoryParams;
};
