import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/business-const';
import { getErrorCodeSpec, StructuredOutputError } from '@lobechat/model-runtime';
import type { OpenAIChatMessage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { BaseService } from '../common/base.service';
import { ApiException, codeForStatus } from '../common/errors';
import type {
  ObjectGeneration,
  ObjectGenerationRequest,
  TextGeneration,
  TextGenerationRequest,
} from '../types/text-generation.type';

type Input = Pick<TextGenerationRequest, 'messages' | 'model' | 'prompt' | 'provider' | 'system'>;

/**
 * Runtime statuses that describe the caller's request (budget, quota, input),
 * kept as they are. Others — provider auth, outages and the runtime's own 4xx
 * codes such as 471 — are the provider's problem and answer 502.
 */
const CALLER_STATUSES = new Set([400, 402, 413, 422, 429]);

const pickString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : undefined;

/**
 * A model-runtime failure (`{ errorType, error }`) or a raw provider error as an
 * API error: budget / quota / input refusals keep their status (402 / 429 /
 * 400…), anything else answers 502 with the provider's reason.
 */
const toApiError = (error: unknown): unknown => {
  if (error instanceof ApiException || !error || typeof error !== 'object') return error;
  const record = error as {
    error?: { message?: unknown };
    errorType?: unknown;
    message?: unknown;
    status?: unknown;
  };
  const errorType = record.errorType;
  const status =
    typeof errorType === 'number'
      ? errorType
      : typeof errorType === 'string'
        ? getErrorCodeSpec(errorType)?.httpStatus
        : typeof record.status === 'number'
          ? record.status
          : undefined;
  if (status === undefined && errorType === undefined) return error;

  const reason =
    pickString(record.error?.message) ?? pickString(record.message) ?? String(errorType ?? status);
  const label = typeof errorType === 'string' ? `${errorType}: ${reason}` : reason;
  if (status && CALLER_STATUSES.has(status))
    return new ApiException(status as 400, codeForStatus(status), label);
  return new ApiException(502, 'upstream_error', `Model provider error (${label})`);
};

/**
 * One-shot text and JSON generation over the same model runtime as the app's
 * `aiChat.outputJSON` (structured output) and server-side completions. Spend is
 * attributed to the public API; nothing is stored as a conversation.
 */
export class TextGenerationRestService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private get ai() {
    return new AiGenerationService(this.db, this.userId, this.workspaceId);
  }

  /** Model and provider, defaulting both together so a bare `model` keeps its own provider. */
  private async resolveModel(input: Input) {
    const model = input.model ?? DEFAULT_MODEL;
    const provider = input.provider ?? (input.model ? undefined : DEFAULT_PROVIDER);
    if (!provider) {
      throw new ApiException(400, 'validation_error', 'Invalid request: provider is required', [
        { message: 'Required when `model` is set', path: 'body.provider' },
      ]);
    }

    const permission = await this.resolveOperationPermission('AI_MODEL_INVOKE', {
      targetModelId: model,
    });
    if (!permission.isPermitted) {
      throw this.createAuthorizationError(permission.message || 'Not allowed to use this model');
    }
    return { model, provider };
  }

  private static messagesOf(input: Input): OpenAIChatMessage[] {
    return [
      ...(input.system ? [{ content: input.system, role: 'system' as const }] : []),
      ...(input.messages ?? []),
      ...(input.prompt ? [{ content: input.prompt, role: 'user' as const }] : []),
    ];
  }

  async generateText(input: TextGenerationRequest): Promise<TextGeneration> {
    const { model, provider } = await this.resolveModel(input);
    try {
      const result = await this.ai.generateText(
        {
          maxTokens: input.maxTokens,
          messages: TextGenerationRestService.messagesOf(input),
          model,
          provider,
          temperature: input.temperature,
        },
        { metadata: { trigger: RequestTrigger.Api } },
      );
      const usage = result.usage;
      return {
        finishReason: result.finishReason ?? null,
        model,
        provider,
        reasoning: result.reasoning ?? null,
        text: result.text,
        usage: usage
          ? {
              inputTokens: usage.totalInputTokens ?? null,
              outputTokens: usage.totalOutputTokens ?? null,
              reasoningTokens: usage.outputReasoningTokens ?? null,
              totalTokens: usage.totalTokens ?? null,
            }
          : null,
      };
    } catch (error) {
      throw toApiError(error);
    }
  }

  async generateObject(input: ObjectGenerationRequest): Promise<ObjectGeneration> {
    const { model, provider } = await this.resolveModel(input);
    let object: unknown;
    try {
      object = await this.ai.generateObject(
        {
          messages: TextGenerationRestService.messagesOf(input),
          model,
          provider,
          schema: {
            description: input.schemaDescription,
            name: input.schemaName,
            schema: input.schema,
            strict: input.strict,
          },
        },
        { metadata: { trigger: RequestTrigger.Api } },
      );
    } catch (error) {
      if (error instanceof StructuredOutputError) object = undefined;
      else throw toApiError(error);
    }

    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      throw new ApiException(
        422,
        'unprocessable_entity',
        'The model reply was not a JSON object matching the schema',
      );
    }
    return { model, object: object as Record<string, unknown>, provider };
  }
}
