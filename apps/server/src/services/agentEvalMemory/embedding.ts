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

/** A dropped connection to the embedding provider must not fail an attempt before the Agent runs. */
export const embedWithRetry: (
  embed: EvalMemoryEmbedder,
  texts: Array<string | null | undefined>,
) => Promise<Array<number[] | undefined>> = async (embed, texts) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await embed(texts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= EMBED_ATTEMPTS || !isTransientFailure(message)) {
        throw new Error(`Eval Memory embedding failed: ${message}`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, EMBED_RETRY_DELAY_MS * attempt));
    }
  }
};
