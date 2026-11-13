import { DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';

import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import {
  initModelRuntimeFromDB,
  initModelRuntimeWithUserPayload,
} from '@/server/modules/ModelRuntime';
import { embedUserMemoryTexts } from '@/server/services/memory/userMemory/embedding';
import type { ToolExecutionMemoryEmbeddingRuntime } from '@/server/services/toolExecution/types';

/** Embeds texts in one request; an empty text keeps its slot as `undefined`. */
export type EvalMemoryEmbedder = (
  texts: Array<string | null | undefined>,
) => Promise<Array<number[] | undefined>>;

/**
 * The same embedding model the account's own Memory uses, billed to the
 * caller as Memory usage. A server-owned runtime (a synthetic actor) wins
 * when the tool execution context carries one.
 */
export const createEvalMemoryEmbedder = (options: {
  db: LobeChatDatabase;
  memoryEmbeddingRuntime?: ToolExecutionMemoryEmbeddingRuntime;
  source: string;
  userId: string;
  workspaceId?: string;
}): EvalMemoryEmbedder => {
  return async (texts) => {
    if (!texts.some((value) => typeof value === 'string' && value.trim())) {
      return texts.map(() => undefined);
    }
    const defaults =
      getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
    const model = options.memoryEmbeddingRuntime?.model ?? defaults.model;
    const runtime = options.memoryEmbeddingRuntime
      ? initModelRuntimeWithUserPayload(
          options.memoryEmbeddingRuntime.provider,
          options.memoryEmbeddingRuntime.payload,
          { userId: options.userId },
        )
      : await initModelRuntimeFromDB(
          options.db,
          options.userId,
          defaults.provider,
          options.workspaceId,
        );
    return embedUserMemoryTexts({
      input: texts,
      model,
      runtime,
      source: options.source,
      userId: options.userId,
    });
  };
};

const EMBED_ATTEMPTS = 3;
const EMBED_RETRY_DELAY_MS = 500;
const isTransientFailure = (message?: string) =>
  /connection error|econnreset|etimedout|socket hang up|fetch failed|terminated|timed? ?out|\b(?:429|502|503|504)\b/i.test(
    message ?? '',
  );

/**
 * Model runtimes often reject with a plain payload (`{ errorType, error }`),
 * not an Error; its text must survive into retry decisions and logs.
 */
const describeFailure = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

/** A dropped connection to the embedding provider must not fail an attempt before the Agent runs. */
export const embedWithRetry: (
  embed: EvalMemoryEmbedder,
  texts: Array<string | null | undefined>,
) => Promise<Array<number[] | undefined>> = async (embed, texts) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await embed(texts);
    } catch (error) {
      const message = describeFailure(error);
      if (attempt >= EMBED_ATTEMPTS || !isTransientFailure(message)) {
        throw new Error(`Eval Memory embedding failed: ${message}`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, EMBED_RETRY_DELAY_MS * attempt));
    }
  }
};

/**
 * Embeds with the account's model when it has a usable one, else takes the
 * simplified path. A dropped connection is retried and then still fails the
 * call: that is an outage, not a missing model. Any other failure (no key, no
 * embedding model, a refused request) means the account cannot embed, so the
 * texts get no vectors, and Memory search ranks an attempt's entries without
 * them (`searchEvalMemory`). Once refused, the embedder stops asking.
 */
export const embedOrSkip = (embed: EvalMemoryEmbedder): EvalMemoryEmbedder => {
  let unavailable = false;
  return async (texts) => {
    if (unavailable) return texts.map(() => undefined);
    try {
      return await embedWithRetry(embed, texts);
    } catch (error) {
      const message = describeFailure(error);
      if (isTransientFailure(message)) throw error;
      unavailable = true;
      console.warn('[eval-memory] no usable embedding model, using simplified Memory search', {
        reason: message.slice(0, 200),
      });
      return texts.map(() => undefined);
    }
  };
};
