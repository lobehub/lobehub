import { DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS } from '@lobechat/const';
import type { Embeddings, ModelRuntime, OpenAIChatMessage } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
} from '@lobechat/observability-otel/gen-ai';
import { tracer } from '@lobechat/observability-otel/modules/memory-user-memory';
import { attributesCommon } from '@lobechat/observability-otel/node';
import { RequestTrigger } from '@lobechat/types';

import { trimBasedOnBatchProbe } from '@/utils/chunkers';
import { encodeAsync } from '@/utils/tokenizer';
import { trimEmbeddingInput } from '@/utils/tokenizer/embedding';

import type { MemoryExtractionExecutorContext } from './context';

export async function countTokens(text: string) {
  const normalized = text.trim();
  if (!normalized) return 0;

  return await encodeAsync(normalized);
}

export async function trimTextToTokenLimit(text: string, tokenLimit?: number) {
  return trimBasedOnBatchProbe(text, tokenLimit);
}

export async function trimConversationsToTokenLimit<T extends OpenAIChatMessage>(
  ctx: MemoryExtractionExecutorContext,
  conversations: (T & { createdAt: Date })[],
  tokenLimit?: number,
) {
  if (!tokenLimit || tokenLimit <= 0) return conversations;

  let remaining = tokenLimit;
  const trimmed: (T & { createdAt: Date })[] = [];

  for (let i = conversations.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const conversation = conversations[i];
    // TODO: we might need to think about how to deal with non-string contents
    // as multi-modal models become more prevalent
    const content =
      typeof conversation.content === 'string'
        ? conversation.content
        : JSON.stringify(conversation.content);

    const tokenCount = await ctx.countTokens(content);
    if (tokenCount <= remaining) {
      trimmed.push(conversation);
      remaining -= tokenCount;
      continue;
    }

    const trimmedContent =
      typeof conversation.content === 'string'
        ? await ctx.trimTextToTokenLimit(conversation.content, remaining)
        : conversation.content;

    if (trimmedContent && remaining > 0) {
      trimmed.push({ ...conversation, content: trimmedContent });
    }

    break;
  }

  return trimmed.reverse();
}

export async function generateEmbeddings(
  runtimes: ModelRuntime,
  model: string,
  texts: Array<string | undefined | null>,
  userId: string,
  tokenLimit?: number,
) {
  const attributes = {
    [ATTR_GEN_AI_OPERATION_NAME]: 'embed',
    [ATTR_GEN_AI_REQUEST_MODEL]: model,
    memory_embedding_token_limit: tokenLimit ?? undefined,
    ...attributesCommon(),
  };

  return tracer.startActiveSpan('gen_ai.embed', { attributes }, async (span) => {
    const requests: { index: number; text: string }[] = [];
    for (const [index, text] of texts.entries()) {
      if (typeof text !== 'string') continue;

      const trimmed = await trimEmbeddingInput(text, model, tokenLimit);
      if (!trimmed.trim()) continue;

      requests.push({ index, text: trimmed });
    }

    span.setAttribute('memory.embedding.text_count', texts.length);
    span.setAttribute('memory.embedding.request_count', requests.length);

    if (requests.length === 0) {
      span.setStatus({ code: SpanStatusCode.OK, message: 'empty_requests' });
      span.end();
      return texts.map(() => null);
    }

    try {
      const response = await runtimes.embeddings(
        {
          dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
          input: requests.map((item) => item.text),
          model,
        },
        { metadata: { trigger: RequestTrigger.Memory }, user: userId },
      );

      const vectors = texts.map<Embeddings | null>(() => null);
      response?.forEach((embedding, idx) => {
        const request = requests[idx];
        if (request) {
          vectors[request.index] = embedding;
        }
      });

      span.setAttribute('memory.embedding.response_count', response?.length ?? 0);
      span.setStatus({ code: SpanStatusCode.OK });

      return vectors;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Failed to generate embeddings',
      });
      span.recordException(error as Error);
      console.error('[memory-extraction] failed to generate embeddings', error, 'model:', model);

      return texts.map(() => null);
    } finally {
      span.end();
    }
  });
}
