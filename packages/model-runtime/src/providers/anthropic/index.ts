import Anthropic, { ClientOptions } from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';

import { hasTemperatureTopPConflict } from '../../const/models';
import { LobeRuntimeAI } from '../../core/BaseAI';
import {
  buildAnthropicMessages,
  buildAnthropicTools,
  buildSearchTool,
} from '../../core/contextBuilders/anthropic';
import { resolveParameters } from '../../core/parameterResolver';
import { AnthropicStream } from '../../core/streams';
import {
  type ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { debugStream } from '../../utils/debugStream';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { getModelPricing } from '../../utils/getModelPricing';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';
import { StreamingResponse } from '../../utils/response';
import { createAnthropicGenerateObject } from './generateObject';
import { handleAnthropicError } from './handleAnthropicError';
import { resolveCacheTTL } from './resolveCacheTTL';
import { resolveMaxTokens } from './resolveMaxTokens';

export interface AnthropicModelCard {
  created_at: string;
  display_name: string;
  id: string;
}

type anthropicTools = Anthropic.Tool | Anthropic.WebSearchTool20250305;

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

interface AnthropicAIParams extends ClientOptions {
  id?: string;
}

export class LobeAnthropicAI implements LobeRuntimeAI {
  private client: Anthropic;

  baseURL: string;
  apiKey?: string;
  private id: string;

  private isDebug() {
    return process.env.DEBUG_ANTHROPIC_CHAT_COMPLETION === '1';
  }

  constructor({
    apiKey,
    baseURL = DEFAULT_BASE_URL,
    id,
    defaultHeaders,
    ...res
  }: AnthropicAIParams = {}) {
    if (!apiKey) throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    const betaHeaders = process.env.ANTHROPIC_BETA_HEADERS;

    this.client = new Anthropic({
      apiKey,
      baseURL,
      defaultHeaders: { ...defaultHeaders, 'anthropic-beta': betaHeaders },
      ...res,
    });
    this.baseURL = this.client.baseURL;
    this.apiKey = apiKey;
    this.id = id || ModelProvider.Anthropic;
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    try {
      const anthropicPayload = await this.buildAnthropicPayload(payload);
      const inputStartAt = Date.now();

      if (this.isDebug()) {
        console.log('[requestPayload]');
        console.log(JSON.stringify(anthropicPayload), '\n');
      }

      const response = await this.client.messages.create(
        {
          ...anthropicPayload,
          metadata: options?.user ? { user_id: options?.user } : undefined,
          stream: true,
        },
        {
          signal: options?.signal,
        },
      );

      const [prod, debug] = response.tee();

      if (this.isDebug()) {
        debugStream(debug.toReadableStream()).catch(console.error);
      }

      const pricing = await getModelPricing(payload.model, this.id);
      const cacheTTL = resolveCacheTTL(payload, anthropicPayload);
      const pricingOptions = cacheTTL ? { lookupParams: { ttl: cacheTTL } } : undefined;

      return StreamingResponse(
        AnthropicStream(prod, {
          callbacks: options?.callback,
          inputStartAt,
          payload: { model: payload.model, pricing, pricingOptions, provider: this.id },
        }),
        {
          headers: options?.headers,
        },
      );
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    try {
      return await createAnthropicGenerateObject(this.client, payload, options);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async buildAnthropicPayload(payload: ChatStreamPayload) {
    const {
      messages,
      model,
      max_tokens,
      temperature,
      top_p,
      tools,
      thinking,
      enabledContextCaching = true,
      enabledSearch,
    } = payload;

    const { anthropic: anthropicModels } = await import('model-bank');

    const resolvedMaxTokens = await resolveMaxTokens({
      max_tokens,
      model,
      providerModels: anthropicModels,
      thinking,
    });

    const system_message = messages.find((m) => m.role === 'system');
    const user_messages = messages.filter((m) => m.role !== 'system');

    const systemPrompts = !!system_message?.content
      ? ([
        {
          cache_control: enabledContextCaching ? { type: 'ephemeral' } : undefined,
          text: system_message?.content as string,
          type: 'text',
        },
      ] as Anthropic.TextBlockParam[])
      : undefined;

    const postMessages = await buildAnthropicMessages(user_messages, { enabledContextCaching });

    let postTools: anthropicTools[] | undefined = buildAnthropicTools(tools, {
      enabledContextCaching,
    });

    if (enabledSearch) {
      const webSearchTool = buildSearchTool();

      if (postTools && postTools.length > 0) {
        postTools = [...postTools, webSearchTool];
      } else {
        postTools = [webSearchTool];
      }
    }

    if (!!thinking && thinking.type === 'enabled') {
      // `temperature` may only be set to 1 when thinking is enabled.
      // `top_p` must be unset when thinking is enabled.
      return {
        max_tokens: resolvedMaxTokens,
        messages: postMessages,
        model,
        system: systemPrompts,
        thinking: {
          ...thinking,
          budget_tokens: thinking?.budget_tokens
            ? Math.min(thinking.budget_tokens, resolvedMaxTokens - 1) // `max_tokens` must be greater than `thinking.budget_tokens`.
            : 1024,
          type: 'enabled',
        },
        tools: postTools,
      } satisfies Anthropic.MessageCreateParams;
    }

    // Resolve temperature and top_p parameters based on model constraints
    const hasConflict = hasTemperatureTopPConflict(model);
    const resolvedParams = resolveParameters(
      { temperature, top_p },
      { hasConflict, normalizeTemperature: true, preferTemperature: true },
    );

    return {
      // claude 3 series model hax max output token of 4096, 3.x series has 8192
      // https://docs.anthropic.com/en/docs/about-claude/models/all-models#:~:text=200K-,Max%20output,-Normal%3A
      max_tokens: resolvedMaxTokens,
      messages: postMessages,
      model,
      system: systemPrompts,
      temperature: resolvedParams.temperature,
      tools: postTools,
      top_p: resolvedParams.top_p,
    } satisfies Anthropic.MessageCreateParams;
  }

  async models() {
    const url = `${this.baseURL}/v1/models`;
    const response = await fetch(url, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': `${this.apiKey}`,
      },
      method: 'GET',
    });
    const json = await response.json();

    const modelList: AnthropicModelCard[] = json['data'];

    const standardModelList = modelList.map((model) => ({
      created: model.created_at,
      displayName: model.display_name,
      id: model.id,
    }));
    return processModelList(standardModelList, MODEL_LIST_CONFIGS.anthropic, 'anthropic');
  }

  private handleError(error: any): ChatCompletionErrorPayload {
    let desensitizedEndpoint = this.baseURL;

    if (this.baseURL !== DEFAULT_BASE_URL) {
      desensitizedEndpoint = desensitizeUrl(this.baseURL);
    }

    if ('status' in (error as any)) {
      switch ((error as Response).status) {
        case 401: {
          throw AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: error as any,
            errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
            provider: this.id,
          });
        }

        case 403: {
          throw AgentRuntimeError.chat({
            endpoint: desensitizedEndpoint,
            error: error as any,
            errorType: AgentRuntimeErrorType.LocationNotSupportError,
            provider: this.id,
          });
        }
        default: {
          break;
        }
      }
    }

    const { errorResult } = handleAnthropicError(error);

    throw AgentRuntimeError.chat({
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: this.id,
    });
  }
}

export default LobeAnthropicAI;
