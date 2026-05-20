import debug from 'debug';
import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { responsesAPIModels, systemToUserModels } from '../../const/models';
import { pruneReasoningPayload } from '../../core/contextBuilders/openai';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatMethodOptions, ChatStreamPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { sanitizeError } from '../../utils/sanitizeError';

const azureImageLogger = debug('lobe-image:azure');
const azureSearchContextSize = process.env.OPENAI_SEARCH_CONTEXT_SIZE;

const isAzureReasoningModel = (model: string) =>
  model.includes('gpt-5') || model.includes('o1') || model.includes('o3');

const supportsImageInputFidelity = (model: string) => /^gpt-image-1(?:$|[-.])/.test(model);

const transformAzureSystemMessages = (messages: ChatStreamPayload['messages'], model: string) =>
  messages.map((message) => ({
    ...message,
    role:
      isAzureReasoningModel(model) && message.role === 'system'
        ? [...systemToUserModels].some((sub) => model.includes(sub))
          ? 'user'
          : 'developer'
        : message.role,
  }));

const appendAzureSearchTool = (
  tools: ChatStreamPayload['tools'],
  enabledSearch?: boolean,
): ChatStreamPayload['tools'] => {
  if (!enabledSearch) return tools;

  return [
    ...(tools || []),
    {
      type: 'web_search',
      ...(azureSearchContextSize && {
        search_context_size: azureSearchContextSize,
      }),
    } as any,
  ];
};

const normalizeAzureBaseURL = (value?: string) => {
  if (!value) return value;

  const url = new URL(value);
  const normalizedPathname = url.pathname.replace(/\/+$/, '');
  const hasOpenAISegment = normalizedPathname.split('/').includes('openai');

  url.pathname = hasOpenAISegment
    ? '/openai/v1'
    : `${normalizedPathname === '/' ? '' : normalizedPathname}/openai/v1`;
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
};

const maskSensitiveUrl = (url: string) => {
  const regex = /^(https:\/\/)([^.]+)(\.(?:openai\.azure\.com|cognitiveservices\.azure\.com).*)$/;

  return url.replace(regex, (match, protocol, subdomain, rest) => `${protocol}***${rest}`);
};

const BaseAzureOpenAI = createOpenAICompatibleRuntime({
  chatCompletion: {
    handlePayload: (payload) => {
      const { deploymentName, enabledSearch, model, ...rest } = payload;
      const requestModel = deploymentName ?? model;

      if (responsesAPIModels.has(model) || enabledSearch) {
        return {
          ...rest,
          apiMode: 'responses',
          enabledSearch,
          model: requestModel,
        } as ChatStreamPayload;
      }

      const updatedMessages = transformAzureSystemMessages(payload.messages, model);
      const azureChatParams = rest as typeof rest & { logit_bias?: Record<string, number> };

      const {
        frequency_penalty,
        logit_bias,
        logprobs,
        max_tokens,
        presence_penalty,
        reasoning_effort,
        temperature,
        top_logprobs,
        top_p,
        ...otherParams
      } = azureChatParams;

      const compatibleReasoningEffort = reasoning_effort === 'minimal' ? 'low' : reasoning_effort;
      // Azure GPT-5 / o1 / o3 reasoning models reject sampling/penalty params, so we drop
      // them entirely for reasoning models and only pass them through for regular chat.
      const supportedSamplingParams = isAzureReasoningModel(model)
        ? {}
        : {
            frequency_penalty,
            logit_bias,
            logprobs,
            max_tokens,
            presence_penalty,
            temperature,
            top_logprobs,
            top_p,
          };

      return {
        ...otherParams,
        ...supportedSamplingParams,
        messages: updatedMessages as OpenAI.Chat.ChatCompletionMessageParam[],
        model: requestModel,
        reasoning_effort: compatibleReasoningEffort as 'low' | 'medium' | 'high' | undefined,
        stream: model.includes('o1') ? false : (payload.stream ?? true),
      } as any;
    },
    useResponseModels: [...responsesAPIModels],
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_AZURE_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_AZURE_RESPONSES === '1',
  },
  provider: ModelProvider.Azure,
  responses: {
    handlePayload: (payload) => {
      const { deploymentName, enabledSearch, model, tools, verbosity, ...rest } = payload;
      const requestModel = deploymentName ?? model;
      const updatedMessages = transformAzureSystemMessages(payload.messages, model);
      const azureTools = appendAzureSearchTool(tools, enabledSearch);
      const responseText = verbosity
        ? payload.text
          ? { ...payload.text, verbosity }
          : { verbosity }
        : payload.text;

      if (isAzureReasoningModel(model)) {
        const reasoning = payload.reasoning
          ? { ...payload.reasoning, summary: 'auto' }
          : { summary: 'auto' };

        return pruneReasoningPayload({
          ...rest,
          messages: updatedMessages,
          model: requestModel,
          reasoning,
          stream: payload.stream ?? true,
          text: responseText,
          tools: azureTools as any,
        } as ChatStreamPayload) as ChatStreamPayload;
      }

      return {
        ...rest,
        messages: updatedMessages,
        model: requestModel,
        text: responseText,
        tools: azureTools,
      } as ChatStreamPayload;
    },
  },
});

export class LobeAzureOpenAI extends BaseAzureOpenAI {
  constructor(options: Record<string, any> = {}) {
    const { endpoint, ...rest } = options;
    const baseURL = normalizeAzureBaseURL(rest.baseURL ?? endpoint);

    super({
      ...rest,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    try {
      return await super.chat(payload, options);
    } catch (error) {
      throw this.attachDeploymentId(error, payload.deploymentName ?? payload.model);
    }
  }

  async createImage(payload: CreateImagePayload) {
    const { model, params } = payload;
    azureImageLogger('Creating image with model: %s and params: %O', model, params);

    try {
      const userInput: Record<string, any> = { ...params };
      const hasImageUrlsInput =
        Array.isArray(userInput.imageUrls) && userInput.imageUrls.length > 0;
      const hasSingleImageUrlInput = userInput.imageUrl && !userInput.image;

      if (hasImageUrlsInput || hasSingleImageUrlInput) {
        const { convertImageUrlToFile } = await import('../../core/contextBuilders/openai');

        if (hasImageUrlsInput) {
          const imageFiles = await Promise.all(
            userInput.imageUrls.map((url: string) => convertImageUrlToFile(url)),
          );
          userInput.image = imageFiles.length === 1 ? imageFiles[0] : imageFiles;
        } else if (hasSingleImageUrlInput) {
          userInput.image = await convertImageUrlToFile(userInput.imageUrl);
        }
      }

      delete userInput.imageUrls;
      delete userInput.imageUrl;

      const isImageEdit = Boolean(userInput.image);
      azureImageLogger('Is Image Edit: %s', isImageEdit);

      if (userInput.size === 'auto') delete userInput.size;

      // gpt-image-2 rejects input_fidelity because it is always high fidelity by default.
      // Keep the parameter limited to the gpt-image-1 family, matching OpenAI-compatible runtime.
      const shouldUseInputFidelity = isImageEdit && supportsImageInputFidelity(model);

      const azureImageOptions: Record<string, any> = {
        model,
        n: 1,
        ...(shouldUseInputFidelity ? { input_fidelity: 'high' } : {}),
        ...userInput,
      };

      if (!isImageEdit) delete azureImageOptions.image;

      const imageResponse = isImageEdit
        ? await this.client.images.edit(azureImageOptions as any)
        : await this.client.images.generate(azureImageOptions as any);

      let result: any = imageResponse;
      if (typeof result === 'string') {
        result = JSON.parse(result);
      } else if (result && typeof result === 'object') {
        if (typeof result.bodyAsText === 'string') {
          result = JSON.parse(result.bodyAsText);
        } else if (typeof result.body === 'string') {
          result = JSON.parse(result.body);
        }
      }

      if (!result || !Array.isArray(result.data) || result.data.length === 0) {
        throw new Error(
          `Invalid image response: missing or empty data array. Response: ${JSON.stringify(result)}`,
        );
      }

      const imageData = result.data[0];
      if (!imageData) {
        throw new Error('Invalid image response: first data item is null or undefined');
      }

      if (imageData.b64_json) {
        return { imageUrl: `data:image/png;base64,${imageData.b64_json}` };
      }

      if (imageData.url) {
        return { imageUrl: imageData.url };
      }

      throw new Error('Invalid image response: missing both b64_json and url fields');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  protected handleError(error: any) {
    let normalizedError = error as { [key: string]: any; code?: string; message?: string };

    if (!normalizedError.code) {
      normalizedError = {
        cause: normalizedError.cause,
        message: normalizedError.message,
        name: normalizedError.name,
      };
    }

    return AgentRuntimeError.chat({
      endpoint: maskSensitiveUrl(this.baseURL),
      error: sanitizeError(normalizedError),
      errorType: normalizedError.code
        ? AgentRuntimeErrorType.ProviderBizError
        : AgentRuntimeErrorType.AgentRuntimeError,
      provider: ModelProvider.Azure,
    });
  }

  /**
   * Keep DeploymentNotFound payload backwards-compatible because callers and
   * tests rely on the failed deployment/model id being present in the error body.
   */
  private attachDeploymentId(error: any, model?: string) {
    if (
      model &&
      error &&
      typeof error === 'object' &&
      error.error &&
      typeof error.error === 'object' &&
      error.error.code === 'DeploymentNotFound' &&
      !error.error.deployId
    ) {
      return {
        ...error,
        error: {
          ...error.error,
          deployId: model,
        },
      };
    }

    return error;
  }
}
