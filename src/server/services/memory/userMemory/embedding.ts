import { DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS } from '@lobechat/const';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { RequestTrigger } from '@lobechat/types';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { trimBasedOnBatchProbe } from '@/utils/chunkers';
import { encodeAsync } from '@/utils/tokenizer';

export interface UserMemoryEmbeddingRuntime {
  /**
   * Runtime embedding method used by memory-specific call sites.
   */
  embeddings: ModelRuntime['embeddings'];
}

/**
 * Options for embedding user-memory text with memory-specific trimming.
 */
export interface EmbedUserMemoryTextsParams {
  /**
   * Embedding dimension requested by the memory table schema.
   *
   * @default DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS
   */
  dimensions?: number;
  /**
   * User memory texts to embed. Empty values keep their output slot as `undefined`.
   */
  input: Array<string | null | undefined>;
  /**
   * Embedding model name passed to the runtime.
   */
  model: string;
  /**
   * Runtime that performs the provider request.
   */
  runtime: UserMemoryEmbeddingRuntime;
  /**
   * Stable call-site label used for trim diagnostics.
   */
  source: string;
  /**
   * User id passed to runtime billing/tracing metadata.
   */
  userId: string;
}

/**
 * Embeds user-memory text after applying the memory embedding context limit.
 *
 * Use when:
 * - User memory search, tools, or maintenance jobs call an embedding model
 * - Inputs may contain long chat/tool payloads or stored memory text
 *
 * Expects:
 * - `input` order must be meaningful to the caller
 * - `runtime.embeddings` returns vectors in request input order
 *
 * Returns:
 * - An output array with the same length as `input`
 * - `undefined` for empty values or values trimmed to empty text
 */
export const embedUserMemoryTexts = async (
  params: EmbedUserMemoryTextsParams,
): Promise<Array<number[] | undefined>> => {
  const { embedding } = parseMemoryExtractionConfig();
  // TODO: Prefer model-bank capability metadata for the embedding input window when available.
  const tokenLimit = embedding.contextLimit;
  const requests: Array<{ index: number; text: string }> = [];

  for (const [index, value] of params.input.entries()) {
    if (typeof value !== 'string') continue;

    const trimmedValue = value.trim();
    if (!trimmedValue) continue;

    const text = tokenLimit ? await trimBasedOnBatchProbe(trimmedValue, tokenLimit) : trimmedValue;
    const normalizedText = text.trim();
    if (!normalizedText) continue;

    if (tokenLimit) {
      const [originalTokens, trimmedTokens] = await Promise.all([
        encodeAsync(trimmedValue),
        encodeAsync(normalizedText),
      ]);

      if (trimmedTokens < originalTokens) {
        console.warn('[user-memory] trimmed embedding input', {
          limit: tokenLimit,
          model: params.model,
          originalTokens,
          source: params.source,
          trimmedTokens,
          userId: params.userId,
        });
      }
    }

    requests.push({ index, text: normalizedText });
  }

  const outputs = params.input.map<number[] | undefined>(() => undefined);
  if (requests.length === 0) return outputs;

  const embeddings = await params.runtime.embeddings(
    {
      dimensions: params.dimensions ?? DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
      input: requests.map((item) => item.text),
      model: params.model,
    },
    { metadata: { trigger: RequestTrigger.Memory }, user: params.userId },
  );

  for (const [requestIndex, embeddingVector] of (embeddings ?? []).entries()) {
    const request = requests[requestIndex];
    if (!request || !embeddingVector) continue;

    outputs[request.index] = embeddingVector;
  }

  return outputs;
};
