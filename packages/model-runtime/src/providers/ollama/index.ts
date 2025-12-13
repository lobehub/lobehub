import type { ChatModelCard } from '@lobechat/types';
import { imageUrlToBase64 } from '@lobechat/utils';
import { ModelProvider } from 'model-bank';
import { Ollama, Tool } from 'ollama/browser';
import { ClientOptions } from 'openai';

import { LobeRuntimeAI } from '../../core/BaseAI';
import { OllamaStream, convertIterableToStream, createModelPullStream } from '../../core/streams';
import {
  ChatMethodOptions,
  ChatStreamPayload,
  Embeddings,
  EmbeddingsPayload,
  ModelRequestOptions,
  OpenAIChatMessage,
  PullModelParams,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { debugStream } from '../../utils/debugStream';
import { createErrorResponse } from '../../utils/errorResponse';
import { StreamingResponse } from '../../utils/response';
import { parseDataUri } from '../../utils/uriParser';
import { OllamaMessage } from './type';

export interface OllamaModelCard {
  name: string;
}

export const params = {
  baseURL: undefined,
  debug: {
    chatCompletion: () => process.env.DEBUG_OLLAMA_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Ollama,
};

export class LobeOllamaAI implements LobeRuntimeAI {
  private client: Ollama;

  baseURL?: string;

  constructor({ baseURL }: ClientOptions = {}) {
    try {
      if (baseURL) new URL(baseURL);
    } catch (e) {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidOllamaArgs, e);
    }

    this.client = new Ollama(!baseURL ? undefined : { host: baseURL });

    if (baseURL) this.baseURL = baseURL;
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    try {
      const abort = () => {
        this.client.abort();
        options?.signal?.removeEventListener('abort', abort);
      };

      options?.signal?.addEventListener('abort', abort);

      const response = await this.client.chat({
        messages: await this.buildOllamaMessages(payload.messages),
        model: payload.model,
        options: {
          frequency_penalty: payload.frequency_penalty,
          presence_penalty: payload.presence_penalty,
          temperature: payload.temperature !== undefined ? payload.temperature / 2 : undefined,
          top_p: payload.top_p,
        },
        stream: true,
        tools: payload.tools as Tool[],
      });

      const stream = convertIterableToStream(response);
      const [prod, debug] = stream.tee();

      if (process.env.DEBUG_OLLAMA_CHAT_COMPLETION === '1') {
        debugStream(debug).catch(console.error);
      }

      return StreamingResponse(OllamaStream(prod, options?.callback), {
        headers: options?.headers,
      });
    } catch (error) {
      const e = error as {
        error: any;
        message: string;
        name: string;
        status_code: number;
      };
      if (e.message === 'fetch failed') {
        throw AgentRuntimeError.chat({
          error: {
            message: 'please check whether your ollama service is available',
          },
          errorType: AgentRuntimeErrorType.OllamaServiceUnavailable,
          provider: ModelProvider.Ollama,
        });
      }

      throw AgentRuntimeError.chat({
        error: {
          ...(typeof e.error !== 'string' ? e.error : undefined),
          message: String(e.error?.message || e.message),
          name: e.name,
          status_code: e.status_code,
        },
        errorType: AgentRuntimeErrorType.OllamaBizError,
        provider: ModelProvider.Ollama,
      });
    }
  }

  async embeddings(payload: EmbeddingsPayload): Promise<Embeddings[]> {
    const input = Array.isArray(payload.input) ? payload.input : [payload.input];
    const promises = input.map((inputText: string) =>
      this.invokeEmbeddingModel({
        dimensions: payload.dimensions,
        input: inputText,
        model: payload.model,
      }),
    );
    return await Promise.all(promises);
  }

  async models() {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const list = await this.client.list();

    const modelList: OllamaModelCard[] = list.models;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.name.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: knownModel?.contextWindowTokens ?? undefined,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall: knownModel?.abilities?.functionCall || false,
          id: model.name,
          reasoning: knownModel?.abilities?.reasoning || false,
          vision: knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  }

  private invokeEmbeddingModel = async (payload: EmbeddingsPayload): Promise<Embeddings> => {
    try {
      const responseBody = await this.client.embeddings({
        model: payload.model,
        prompt: payload.input as string,
      });
      return responseBody.embedding;
    } catch (error) {
      const e = error as { message: string; name: string; status_code: number };

      throw AgentRuntimeError.chat({
        error: { message: e.message, name: e.name, status_code: e.status_code },
        errorType: AgentRuntimeErrorType.OllamaBizError,
        provider: ModelProvider.Ollama,
      });
    }
  };

  private async buildOllamaMessages(messages: OpenAIChatMessage[]) {
    return Promise.all(messages.map((message) => this.convertContentToOllamaMessage(message)));
  }

  private convertContentToOllamaMessage = async (
    message: OpenAIChatMessage,
  ): Promise<OllamaMessage> => {
    if (typeof message.content === 'string') {
      return { content: message.content, role: message.role };
    }

    const ollamaMessage: OllamaMessage = {
      content: '',
      role: message.role,
    };

    // Collect image processing tasks for parallel execution
    const imagePromises: Array<Promise<string | null> | string> = [];

    for (const content of message.content) {
      switch (content.type) {
        case 'text': {
          // keep latest text input
          ollamaMessage.content = content.text;
          break;
        }
        case 'image_url': {
          const { base64, type } = parseDataUri(content.image_url.url);

          // If already base64 format, use it directly
          if (base64) {
            imagePromises.push(base64);
          }
          // If it's a URL, add async conversion task with error handling
          else if (type === 'url') {
            imagePromises.push(
              imageUrlToBase64(content.image_url.url)
                .then((result) => result.base64)
                .catch(() => null), // Silently ignore failed conversions
            );
          }
          break;
        }
      }
    }

    // Process all images in parallel and filter out failed conversions
    if (imagePromises.length > 0) {
      const results = await Promise.all(imagePromises);
      const validImages = results.filter((img): img is string => img !== null);
      if (validImages.length > 0) {
        ollamaMessage.images = validImages;
      }
    }

    return ollamaMessage;
  };

  async pullModel(params: PullModelParams, options?: ModelRequestOptions): Promise<Response> {
    const { model, insecure } = params;
    const signal = options?.signal; // 获取传入的 AbortSignal

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const abortOllama = () => {
      // 假设 this.client.abort() 是幂等的或者可以安全地多次调用
      this.client.abort();
    };

    // 如果有 AbortSignal，监听 abort 事件
    // 使用 { once: true } 确保监听器只触发一次
    signal?.addEventListener('abort', abortOllama, { once: true });

    try {
      // 获取 Ollama pull 的迭代器
      const iterable = await this.client.pull({
        insecure: insecure ?? false,
        model,
        stream: true,
      });

      // 使用专门的模型下载流转换方法
      const progressStream = createModelPullStream(iterable, model, {
        onCancel: () => {
          // 当流被取消时，调用 abortOllama
          // 移除 signal 的监听器，避免重复调用（如果 abortOllama 不是幂等的）
          signal?.removeEventListener('abort', abortOllama);
          abortOllama(); // 执行中止逻辑
        },
      });

      // 返回标准响应
      return new Response(progressStream, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      // 如果在调用 client.pull 或创建流的初始阶段出错，需要移除监听器
      signal?.removeEventListener('abort', abortOllama);

      // 处理错误
      if ((error as Error).message === 'fetch failed') {
        return createErrorResponse(AgentRuntimeErrorType.OllamaServiceUnavailable, {
          message: 'please check whether your ollama service is available',
          provider: ModelProvider.Ollama,
        });
      }

      console.error('model download error:', error);

      // 检查是否是取消操作
      if ((error as Error).name === 'AbortError') {
        return new Response(
          JSON.stringify({
            model,
            status: 'cancelled',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 499,
          },
        );
      }

      // 返回错误响应
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({
          error: errorMessage,
          model,
          status: 'error',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        },
      );
    }
  }
}

export default LobeOllamaAI;
