import type {
  ChatCompletionTool,
  GenerateObjectPayload,
  GenerateObjectSchema,
} from '@lobechat/model-runtime';
import type { OpenAIChatMessage, RequestTrigger } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeForRequest } from '@/server/modules/AgentRuntime/llmRelay/oneShot';

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
   * Context forwarded to non-tracing hooks (billing, routing). Use `tracing`
   * instead for `llm_generation_tracing` config.
   *
   * `trigger` is required: it is the feature recorded on spend / route-attempt
   * logs, and a missing one leaves the usage unattributed. It names the feature
   * (e.g. `task`), not the prompt — the prompt goes in `tracing.scenario`.
   */
  metadata: Record<string, unknown> & { trigger: RequestTrigger };
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
 * Thin wrapper around `initModelRuntimeForRequest` + `ModelRuntime.generateObject`.
 *
 * Almost every server-side caller that produces structured output goes through
 * the same two-step dance: resolve the user's provider config from the DB,
 * then call generateObject with caller-specific metadata. This service exists
 * so those call sites don't repeat the init wiring, and so adding a future
 * cross-cutting concern (default metadata, retries, observability defaults)
 * has one place to land.
 *
 * Construct one per request — `db` and `userId` come from the request context.
 *
 * A provider only the user's device reaches (Ollama, LM Studio, a private base
 * URL; `agent_llm_relay` on) is relayed to the browser tab that sent the
 * request; with no such tab — a bot, a workflow, deferred work — the call
 * fails at once with `ClientLlmExecutorUnavailable` (`no_executor`).
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
    options: AiGenerationObjectOptions,
  ): Promise<T> {
    const runtime = await initModelRuntimeForRequest(this.db, this.userId, input.provider, {
      workspaceId: this.workspaceId,
    });
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
