import { trimBasedOnBatchProbe } from '../chunkers';

const CL100K_EMBEDDING_MODELS = new Set([
  'text-embedding-ada-002',
  'text-embedding-3-large',
  'text-embedding-3-small',
]);

/** Resolve a model's input window without borrowing a chat model's larger window. */
export const resolveEmbeddingTokenLimit = (model: string, limit?: number) => {
  const configured =
    typeof limit === 'number' && Number.isFinite(limit) && limit >= 1
      ? Math.floor(limit)
      : undefined;

  return CL100K_EMBEDDING_MODELS.has(model) ? Math.min(configured ?? 8192, 8192) : configured;
};

/**
 * Keep recent text within the known embedding tokenizer's input window.
 * Custom models retain the configured, estimated trimming behavior: their tokenizer is unknown.
 */
export const trimEmbeddingInput = async (text: string, model: string, limit?: number) => {
  const tokenLimit = resolveEmbeddingTokenLimit(model, limit);
  if (!CL100K_EMBEDDING_MODELS.has(model)) return trimBasedOnBatchProbe(text, tokenLimit);
  const input = text.trim();
  if (!input) return input;

  // Load the vocabulary only on this server-side embedding path, not for UI token estimates.
  const { encode } = await import('gpt-tokenizer/encoding/cl100k_base');
  const count = (value: string) => encode(value, { disallowedSpecial: new Set() }).length;
  if (count(input) <= tokenLimit!) return input;

  // Slice original code points, not decoded token fragments, to avoid replacement characters.
  const characters = Array.from(input);
  let low = 0;
  let high = characters.length;
  let result = '';
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = characters.slice(mid).join('').trim();
    if (count(candidate) <= tokenLimit!) {
      result = candidate;
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  // BPE suffix costs need not be monotonic; only return a candidate we actually counted.
  return result;
};
