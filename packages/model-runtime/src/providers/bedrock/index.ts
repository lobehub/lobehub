import type Anthropic from '@anthropic-ai/sdk';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { cloudModelIdMapping } from '@lobechat/business-const';
import { ModelProvider } from 'model-bank';

import { hasTemperatureTopPConflict } from '../../const/models';
import type { LobeRuntimeAI } from '../../core/BaseAI';
import { buildAnthropicMessages, buildAnthropicTools } from '../../core/contextBuilders/anthropic';
import { resolveParameters } from '../../core/parameterResolver';
import {
  AWSBedrockClaudeStream,
  AWSBedrockLlamaStream,
  createBedrockStream,
} from '../../core/streams';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  Embeddings,
  EmbeddingsOptions,
  EmbeddingsPayload,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { debugStream } from '../../utils/debugStream';
import { getModelPricing } from '../../utils/getModelPricing';
import { StreamingResponse } from '../../utils/response';
import { resolveCacheTTL } from '../../core/anthropicCompatibleFactory/resolveCacheTTL';
import { resolveMaxTokens } from '../../core/anthropicCompatibleFactory/resolveMaxTokens';

/**
 * A prompt constructor for HuggingFace LLama 2 chat models.
 * Does not support `function` messages.
 * @see https://huggingface.co/meta-llama/Llama-2-70b-chat-hf and https://huggingface.co/blog/llama2#how-to-prompt-llama-2
 */
export function experimental_buildLlama2Prompt(messages: { content: string; role: string }[]) {
  const startPrompt = `<s>[INST] `;
  const endPrompt = ` [/INST]`;
  const conversation = messages.map(({ content, role }, index) => {
    switch (role) {
      case 'user': {
        return content.trim();
      }
      case 'assistant': {
        return ` [/INST] ${content}</s><s>[INST] `;
      }
      case 'function': {
        throw new Error('Llama 2 does not support function calls.');
      }
      default: {
        if (role === 'system' && index === 0) {
          return `<<SYS>>\n${content}\n<</SYS>>\n\n`;
        } else {
          throw new Error(`Invalid message role: ${role}`);
        }
      }
    }
  });

  return startPrompt + conversation.join('') + endPrompt;
}

export interface LobeBedrockAIParams {
  accessKeyId?: string;
  accessKeySecret?: string;
  id?: string;
  region?: string;
  sessionToken?: string;
}

export class LobeBedrockAI implements LobeRuntimeAI {
  private client: BedrockRuntimeClient;
  private id: string;

  region: string;

  constructor(options: LobeBedrockAIParams = {}) {
    const { id, region, accessKeyId, accessKeySecret, sessionToken } = options;

    if (!(accessKeyId && accessKeySecret))
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidBedrockCredentials);
    this.region = region ?? 'us-east-1';
    this.id = id ?? ModelProvider.Bedrock;
    this.client = new BedrockRuntimeClient({
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: accessKeySecret,
        sessionToken: sessionToken,
      },
      region: this.region,
    });
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    if (payload.model.startsWith('meta')) return this.invokeLlamaModel(payload, options);

    return this.invokeClaudeModel(payload, options);
  }
  /**
   * Supports the Amazon Titan Text models series.
   * Cohere Embed models are not supported
   * because the current text size per request
   * exceeds the maximum 2048 characters limit
   * for a single request for this series of models.
   * [bedrock embed guide] https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed.html
   */
  async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions): Promise<Embeddings[]> {
    const input = Array.isArray(payload.input) ? payload.input : [payload.input];
    const promises = input.map((inputText: string) =>
      this.invokeEmbeddingModel(
        {
          dimensions: payload.dimensions,
          input: inputText,
          model: payload.model,
        },
        options,
      ),
    );
    return Promise.all(promises);
  }

  private invokeEmbeddingModel = async (
    payload: EmbeddingsPayload,
    options?: EmbeddingsOptions,
  ): Promise<Embeddings> => {
    const command = new InvokeModelCommand({
      accept: 'application/json',
      body: JSON.stringify({
        dimensions: payload.dimensions,
        inputText: payload.input,
        normalize: true,
      }),
      contentType: 'application/json',
      modelId: payload.model,
    });
    try {
      const res = await this.client.send(command, { abortSignal: options?.signal });
      const responseBody = JSON.parse(new TextDecoder().decode(res.body));
      return responseBody.embedding;
    } catch (e) {
      const err = e as Error & { $metadata: any };
      throw AgentRuntimeError.chat({
        error: {
          body: err.$metadata,
          message: err.message,
          type: err.name,
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: this.id,
        region: this.region,
      });
    }
  };

  private invokeClaudeModel = async (
    payload: ChatStreamPayload,
    options?: ChatMethodOptions,
  ): Promise<Response> => {
    const {
      effort,
      enabledContextCaching = true,
      max_tokens,
      messages,
      model,
      temperature,
      top_p,
      tools,
      thinking,
    } = payload;
    const inputStartAt = Date.now();
    const system_message = messages.find((m) => m.role === 'system');
    const user_messages = messages.filter((m) => m.role !== 'system');

    const { bedrock: bedrockModels } = await import('model-bank');

    const resolvedMaxTokens = await resolveMaxTokens({
      max_tokens,
      model,
      providerModels: bedrockModels,
      thinking,
    });

    const systemPrompts = !!system_message?.content
      ? ([
          {
            cache_control: enabledContextCaching ? { type: 'ephemeral' } : undefined,
            text: system_message.content as string,
            type: 'text',
          },
        ] as Anthropic.TextBlockParam[])
      : undefined;

    const postTools = buildAnthropicTools(tools, {
      enabledContextCaching,
    });

    const postMessages = await buildAnthropicMessages(user_messages, { enabledContextCaching });

    // Claude Opus 4.6 does not support assistant turn prefill
    if (model.includes('opus-4-6') && postMessages.at(-1)?.role === 'assistant') {
      postMessages.pop();
    }

    const anthropicBase = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: resolvedMaxTokens,
      messages: postMessages,
      system: systemPrompts,
      tools: postTools,
    };

    let anthropicPayload;

    if (!!thinking && (thinking.type === 'enabled' || thinking.type === 'adaptive')) {
      const resolvedThinking =
        thinking.type === 'enabled'
          ? {
              budget_tokens: Math.min(
                thinking?.budget_tokens || 1024,
                resolvedMaxTokens - 1,
              ),
              type: 'enabled' as const,
            }
          : { type: 'adaptive' as const };

      anthropicPayload = {
        ...anthropicBase,
        ...(thinking.type === 'adaptive' && effort ? { output_config: { effort } } : {}),
        thinking: resolvedThinking,
      };
    } else {
      // Resolve temperature and top_p parameters based on model constraints
      const hasConflict = hasTemperatureTopPConflict(model);
      const resolvedParams = resolveParameters(
        { temperature, top_p },
        { hasConflict, normalizeTemperature: true, preferTemperature: true },
      );

      anthropicPayload = {
        ...anthropicBase,
        temperature: resolvedParams.temperature,
        top_p: resolvedParams.top_p,
      };
    }

    const command = new InvokeModelWithResponseStreamCommand({
      accept: 'application/json',
      body: JSON.stringify(anthropicPayload),
      contentType: 'application/json',
      modelId: cloudModelIdMapping[model] || model,
    });

    try {
      // Ask Claude for a streaming chat completion given the prompt
      const res = await this.client.send(command, { abortSignal: options?.signal });

      const claudeStream = createBedrockStream(res);

      const [prod, debug] = claudeStream.tee();

      if (process.env.DEBUG_BEDROCK_CHAT_COMPLETION === '1') {
        debugStream(debug).catch(console.error);
      }

      const pricing = await getModelPricing(payload.model, this.id);
      const cacheTTL = resolveCacheTTL({ ...payload, enabledContextCaching }, anthropicBase);
      const pricingOptions = cacheTTL ? { lookupParams: { ttl: cacheTTL } } : undefined;

      // Respond with the stream
      return StreamingResponse(
        AWSBedrockClaudeStream(prod, {
          callbacks: options?.callback,
          inputStartAt,
          payload: { model, pricing, pricingOptions, provider: this.id },
        }),
        {
          headers: options?.headers,
        },
      );
    } catch (e) {
      const err = e as Error & { $metadata: any };

      throw AgentRuntimeError.chat({
        error: {
          body: err.$metadata,
          message: err.message,
          type: err.name,
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: this.id,
        region: this.region,
      });
    }
  };

  private invokeLlamaModel = async (
    payload: ChatStreamPayload,
    options?: ChatMethodOptions,
  ): Promise<Response> => {
    const { max_tokens, messages, model } = payload;
    const command = new InvokeModelWithResponseStreamCommand({
      accept: 'application/json',
      body: JSON.stringify({
        max_gen_len: max_tokens || 400,
        prompt: experimental_buildLlama2Prompt(messages as any),
      }),
      contentType: 'application/json',
      modelId: model,
    });

    try {
      // Ask Claude for a streaming chat completion given the prompt
      const res = await this.client.send(command);

      const stream = createBedrockStream(res);

      const [prod, debug] = stream.tee();

      if (process.env.DEBUG_BEDROCK_CHAT_COMPLETION === '1') {
        debugStream(debug).catch(console.error);
      }
      // Respond with the stream
      return StreamingResponse(AWSBedrockLlamaStream(prod, options?.callback), {
        headers: options?.headers,
      });
    } catch (e) {
      const err = e as Error & { $metadata: any };

      throw AgentRuntimeError.chat({
        error: {
          body: err.$metadata,
          message: err.message,
          region: this.region,
          type: err.name,
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: this.id,
        region: this.region,
      });
    }
  };
}

export default LobeBedrockAI;
