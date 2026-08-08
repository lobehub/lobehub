import type {
  ChatCompletionTool,
  GenerateObjectPayload,
  GenerateObjectSchema,
} from '@lobechat/model-runtime';
import type { OpenAIChatMessage } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

export interface AiGenerationObjectInput {
  messages: OpenAIChatMessage[] | GenerateObjectPayload['messages'];
  model: string;
  provider: string;
  schema?: GenerateObjectSchema;
  thinking?: GenerateObjectPayload['thinking'];
  tools?: ChatCompletionTool[];
}

export interface AiGenerationObjectOptions {
  /**
   * Free-form context forwarded to non-tracing hooks (billing, routing). Use
   * `tracing` instead for `llm_generation_tracing` config.
   */
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  /**
   * Structured tracing config (scenario / promptVersion / schemaName /
   * agentId / topicId / inputHint / ...). Forwarded to the
   * `llm_generation_tracing` hook. Strongly typed by `TracingOptions` from
   * `@lobechat/llm-generation-tracing` at call sites.
   */
  tracing?: Record<string, unknown>;
}

/**
 * Thin wrapper around `initModelRuntimeFromDB` + `ModelRuntime.generateObject`.
 *
 * Almost every server-side caller that produces structured output goes through
 * the same two-step dance: resolve the user's provider config from the DB,
 * then call generateObject with caller-specific metadata. This service exists
 * so those call sites don't repeat the init wiring, and so adding a future
 * cross-cutting concern (default metadata, retries, observability defaults)
 * has one place to land.
 *
 * Construct one per request — `db` and `userId` come from the request context.
 */
export class AiGenerationService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  async generateObject<T = unknown>(
    input: AiGenerationObjectInput,
    options: AiGenerationObjectOptions = {},
  ): Promise<T> {
    const runtime = this.workspaceId
      ? await initModelRuntimeFromDB(this.db, this.userId, input.provider, this.workspaceId)
      : await initModelRuntimeFromDB(this.db, this.userId, input.provider);
    return (await runtime.generateObject(
      {
        messages: input.messages as GenerateObjectPayload['messages'],
        model: input.model,
        schema: input.schema,
        thinking: input.thinking,
        tools: input.tools,
      },
      { metadata: options.metadata, signal: options.signal, tracing: options.tracing },
    )) as T;
  }
}
