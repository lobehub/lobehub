import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import type {
  ChatCompletionTool,
  GenerateObjectPayload,
  GenerateObjectSchema,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
} from '@lobechat/observability-otel/gen-ai';
import { tracer } from '@lobechat/observability-otel/modules/memory-user-memory';
import type { z } from 'zod';

import type {
  ExtractorOptions,
  ExtractorTemplateProps,
  MemoryExtractionAgent,
  TemplateProps,
} from '../types';
import { buildGenerateObjectSchema } from '../utils/zod';

const serializeForSpan = (value: unknown, limit = 4000) => {
  if (value === undefined) return undefined;

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return serialized;

    return serialized.length > limit ? `${serialized.slice(0, limit)}...` : serialized;
  } catch {
    return '[unserializable]';
  }
};

export interface BaseMemoryExtractorConfig {
  agent: MemoryExtractionAgent;
  model: string;
  modelRuntime: ModelRuntime;
}

export abstract class BaseMemoryExtractor<
  TOutput,
  TExtractorTemplateProps extends ExtractorTemplateProps = ExtractorTemplateProps,
  TExtractorOptions extends ExtractorOptions = ExtractorOptions,
> {
  protected readonly model: string;
  protected readonly agent: MemoryExtractionAgent;
  protected readonly runtime: ModelRuntime;

  protected promptTemplate: string | undefined;

  constructor(config: BaseMemoryExtractorConfig) {
    this.model = config.model;
    this.agent = config.agent;
    this.runtime = config.modelRuntime;
  }

  protected abstract getPrompt(): string;
  protected getPromptName(): string {
    return this.agent;
  }
  protected abstract getResultSchema(): z.ZodType<TOutput> | undefined;

  protected getSchema(_options: TExtractorTemplateProps): GenerateObjectSchema | undefined {
    const schema = this.getResultSchema();
    if (!schema) return undefined;

    return buildGenerateObjectSchema(schema, {
      name: this.getPromptName().replaceAll(/\W+/g, '_'),
    });
  }

  protected getTemplateProps(options: TExtractorTemplateProps): TemplateProps {
    return {
      language: options.language || 'English',
      topK: options.topK ?? 10,
      username: options.username || 'User',
    } satisfies TemplateProps;
  }

  protected getTools(_options: TExtractorTemplateProps): ChatCompletionTool[] | undefined {
    return undefined;
  }

  private buildMessages(options: TExtractorOptions): GenerateObjectPayload['messages'] {
    const systemPrompt = this.buildSystemPrompt(options as unknown as TExtractorTemplateProps);
    const userPrompt = this.buildUserPrompt(options as unknown as TExtractorTemplateProps);

    return [
      { content: systemPrompt, role: 'system' as const },
      // TODO: additional messages typing issue
      ...((options?.additionalMessages || []) as GenerateObjectPayload['messages']),
      { content: userPrompt, role: 'user' as const },
    ];
  }

  async ensurePromptTemplate(): Promise<void> {
    if (this.promptTemplate) return;

    this.promptTemplate = this.getPrompt();
  }

  private buildSystemPrompt(options: TExtractorTemplateProps): string {
    return renderPlaceholderTemplate(this.promptTemplate || '', this.getTemplateProps(options));
  }

  protected abstract buildUserPrompt(options: TExtractorTemplateProps): string;

  async structuredCall(options?: TExtractorOptions): Promise<TOutput> {
    return tracer.startActiveSpan(`structuredCall: ${this.getPromptName()}`, async (span) => {
      await this.ensurePromptTemplate();

      const messages = this.buildMessages(options as TExtractorOptions);
      const payload: GenerateObjectPayload = {
        messages,
        model: this.model,
        schema: this.getSchema(options as unknown as TExtractorTemplateProps),
        tools: this.getTools(options as unknown as TExtractorTemplateProps),
      };

      span.setAttributes({
        memory_has_schema: Boolean(payload.schema),
        memory_message_count: payload.messages.length,
        memory_prompt_file: this.getPromptName(),
        memory_tool_count: payload.tools?.length ?? 0,
        model: this.model,
      });

      try {
        return tracer.startActiveSpan(
          `generate_content: ${this.model}`,
          {
            attributes: {
              [ATTR_GEN_AI_OPERATION_NAME]: 'generate_content',
              [ATTR_GEN_AI_REQUEST_MODEL]: this.model,
              'lobe-chat.memory.extractor.context': options?.retrievedContexts,
              'lobe-chat.memory.extractor.identities_context': options?.retrievedIdentitiesContext,
              'lobe-chat.memory.extractor.language': options?.language,
              'lobe-chat.memory.extractor.source_id': options?.sourceId,
              'lobe-chat.memory.extractor.top_k': options?.topK,
              'lobe-chat.memory.extractor.user_id': options?.userId,
            },
          },
          async (span) => {
            try {
              try {
                if (options?.callbacks?.onExtractRequest) {
                  await options.callbacks.onExtractRequest(this.agent, payload);
                }
              } catch (err) {
                console.error('onExtractRequest callback error', err);
                // ignore
              }

              span.addEvent('gen_ai.request.send');
              const result = await this.runtime.generateObject(payload);
              span.addEvent('gen_ai.response.receive');

              span.setAttributes({
                'gen_ai.output.openai.structured_output': serializeForSpan(result),
              });

              try {
                if (options?.callbacks?.onExtractResponse) {
                  await options.callbacks.onExtractResponse<TOutput>(this.agent, result as TOutput);
                }
              } catch (err) {
                console.error('onExtractResponse callback error', err);
                // ignore
              }

              const schema = this.getResultSchema();
              const parsedResult = (schema ? schema.parse(result) : result) as TOutput;

              span.setStatus({ code: SpanStatusCode.OK });

              return parsedResult;
            } catch (error) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : 'Structured call failed',
              });
              span.recordException(error as Error);

              try {
                if (options?.callbacks?.onExtractError) {
                  await options.callbacks.onExtractError(this.agent, error);
                }
              } catch (err) {
                console.error('onExtractError callback error', err);
                // ignore
              }

              throw error;
            } finally {
              span.end();
            }
          },
        );
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Structured call failed',
        });
        span.recordException(error as Error);

        throw error;
      } finally {
        span.end();
      }
    });
  }
}
