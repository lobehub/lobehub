import { DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS } from '@lobechat/const';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { RequestTrigger, type SpendOrigin } from '@lobechat/types';

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
   * Origin attribution for the embedding spend. A shared-agent visitor run
   * supplies it so the embedding is billed to the shared agent instead of
   * disappearing into the creator's plain memory usage; its `trigger`
   * overrides the default {@link RequestTrigger.Memory}.
   */
  spendOrigin?: SpendOrigin;
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

  const expectedDimensions = params.dimensions ?? DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS;

  let embeddings: Array<number[] | null | undefined>;
  try {
    embeddings = await params.runtime.embeddings(
      {
        dimensions: expectedDimensions,
        input: requests.map((item) => item.text),
        model: params.model,
      },
      {
        metadata: {
          ...params.spendOrigin,
          trigger: params.spendOrigin?.trigger ?? RequestTrigger.Memory,
        },
        user: params.userId,
      },
    );
  } catch (error) {
    // Provider errors used to surface as an opaque "Failed to save identity
    // memory: undefined" in the UI. Name the memory embedding model and the
    // most common cause so self-hosted operators can act on it.
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[user-memory] embedding request failed for model "${params.model}" (requested dimensions: ${expectedDimensions}). ` +
        `Most OpenAI-compatible endpoints reject a fixed "dimensions" parameter — point MEMORY_USER_MEMORY_EMBEDDING_MODEL at an embedding model that supports it. ` +
        `Original error: ${reason}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }

  for (const [requestIndex, embeddingVector] of (embeddings ?? []).entries()) {
    const request = requests[requestIndex];
    if (!request || !embeddingVector) continue;

    // The user-memory tables pin pgvector columns to
    // DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS. A model returning a different
    // length would fail the insert with a cryptic pgvector size mismatch
    // (or silently break similarity search), so fail early with a clear cause.
    if (embeddingVector.length !== expectedDimensions) {
      throw new Error(
        `[user-memory] embedding model "${params.model}" returned ${embeddingVector.length}-dimensional vectors, ` +
          `but the memory tables store ${expectedDimensions}-dimensional vectors. ` +
          `Switch MEMORY_USER_MEMORY_EMBEDDING_MODEL to a model matching the stored dimensions.`,
      );
    }

    outputs[request.index] = embeddingVector;
  }

  return outputs;
};
