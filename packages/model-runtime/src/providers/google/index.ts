import type {
  GenerateContentConfig,
  HttpOptions,
  ThinkingConfig,
  Tool as GoogleFunctionCallTool,
} from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import debug from 'debug';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { buildGoogleMessages, buildGoogleTools } from '../../core/contextBuilders/google';
import { GoogleGenerativeAIStream, VertexAIStream } from '../../core/streams';
import { LOBE_ERROR_KEY } from '../../core/streams/google';
import type {
  ChatCompletionTool,
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { debugStream } from '../../utils/debugStream';
import { getModelPricing } from '../../utils/getModelPricing';
import { parseGoogleErrorMessage } from '../../utils/googleErrorParser';
import { StreamingResponse } from '../../utils/response';
import { createGoogleImage } from './createImage';
import { createGoogleGenerateObject, createGoogleGenerateObjectWithTools } from './generateObject';
import { resolveGoogleThinkingConfig } from './thinkingResolver';

const log = debug('model-runtime:google');

const modelsOffSafetySettings = new Set(['gemini-2.0-flash-exp']);

const modelsWithModalities = new Set([
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'nano-banana-pro-preview',
]);

const modelsDisableInstuction = new Set([
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image',
  'gemma-3-1b-it',
  'gemma-3-4b-it',
  'gemma-3-12b-it',
  'gemma-3-27b-it',
  'gemma-3n-e4b-it',
  // ZenMux
  'google/gemini-2.5-flash-image-free',
  'google/gemini-2.5-flash-image',
  'google/gemini-3-pro-image-preview-free',
  'google/gemini-3-pro-image-preview',
]);

export interface GoogleModelCard {
  displayName: string;
  inputTokenLimit: number;
  name: string;
  outputTokenLimit: number;
}

enum HarmCategory {
  HARM_CATEGORY_DANGEROUS_CONTENT = 'HARM_CATEGORY_DANGEROUS_CONTENT',
  HARM_CATEGORY_HARASSMENT = 'HARM_CATEGORY_HARASSMENT',
  HARM_CATEGORY_HATE_SPEECH = 'HARM_CATEGORY_HATE_SPEECH',
  HARM_CATEGORY_SEXUALLY_EXPLICIT = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
}

enum HarmBlockThreshold {
  BLOCK_NONE = 'BLOCK_NONE',
}

function getThreshold(model: string): HarmBlockThreshold {
  if (modelsOffSafetySettings.has(model)) {
    return 'OFF' as HarmBlockThreshold; // https://discuss.ai.google.dev/t/59352
  }
  return HarmBlockThreshold.BLOCK_NONE;
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface LobeGoogleAIParams {
  apiKey?: string;
  baseURL?: string;
  client?: GoogleGenAI;
  defaultHeaders?: Record<string, any>;
  id?: string;
  isVertexAi?: boolean;
}

const isAbortError = (error: Error): boolean => {
  const message = error.message.toLowerCase();
  return (
    message.includes('aborted') ||
    message.includes('cancelled') ||
    message.includes('error reading from the stream') ||
    message.includes('abort') ||
    error.name === 'AbortError'
  );
};

export class LobeGoogleAI implements LobeRuntimeAI {
  private client: GoogleGenAI;
  private isVertexAi: boolean;
  baseURL?: string;
  apiKey?: string;
  provider: string;

  constructor({
    apiKey,
    baseURL,
    client,
    isVertexAi,
    id,
    defaultHeaders,
  }: LobeGoogleAIParams = {}) {
    if (!apiKey) throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    const httpOptions = baseURL
      ? ({ baseUrl: baseURL, headers: defaultHeaders } as HttpOptions)
      : undefined;

    this.apiKey = apiKey;
    this.client = client ? client : new GoogleGenAI({ apiKey, httpOptions });
    this.baseURL = client ? undefined : baseURL || DEFAULT_BASE_URL;
    this.isVertexAi = isVertexAi || false;

    this.provider = id || (isVertexAi ? 'vertexai' : 'google');
  }

  async chat(rawPayload: ChatStreamPayload, options?: ChatMethodOptions) {
    try {
      const payload = this.buildPayload(rawPayload);
      const { model, thinkingBudget, thinkingLevel, imageAspectRatio, imageResolution } = payload;

      // https://ai.google.dev/gemini-api/docs/thinking#set-budget
      const thinkingConfig = resolveGoogleThinkingConfig(model, {
        thinkingBudget,
        thinkingLevel,
      }) as ThinkingConfig;

      const contents = await buildGoogleMessages(payload.messages);

      const controller = new AbortController();
      const originalSignal = options?.signal;

      if (originalSignal) {
        if (originalSignal.aborted) {
          controller.abort();
        } else {
          originalSignal.addEventListener('abort', () => {
            controller.abort();
          });
        }
      }

      const config: GenerateContentConfig = {
        abortSignal: originalSignal,
        imageConfig:
          modelsWithModalities.has(model) && imageAspectRatio
            ? {
                aspectRatio: imageAspectRatio,
                imageSize: imageResolution,
              }
            : undefined,
        maxOutputTokens: payload.max_tokens,
        responseModalities: modelsWithModalities.has(model) ? ['Text', 'Image'] : undefined,
        // avoid wide sensitive words
        // refs: https://github.com/lobehub/lobe-chat/pull/1418
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: getThreshold(model),
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: getThreshold(model),
          },
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: getThreshold(model),
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: getThreshold(model),
          },
        ],
        systemInstruction: modelsDisableInstuction.has(model)
          ? undefined
          : (payload.system as string),
        temperature: payload.temperature,
        thinkingConfig:
          modelsDisableInstuction.has(model) || model.toLowerCase().includes('learnlm')
            ? undefined
            : thinkingConfig,
        tools: this.buildGoogleToolsWithSearch(payload.tools, payload),
        topP: payload.top_p,
      };

      const inputStartAt = Date.now();

      const finalPayload = { config, contents, model };
      const key = this.isVertexAi
        ? 'DEBUG_VERTEX_AI_CHAT_COMPLETION'
        : 'DEBUG_GOOGLE_CHAT_COMPLETION';

      if (process.env[key] === '1') {
        console.log('[requestPayload]');
        console.log(JSON.stringify(finalPayload), '\n');
      }

      const geminiStreamResponse = await this.client.models.generateContentStream(finalPayload);

      const googleStream = this.createEnhancedStream(geminiStreamResponse, controller.signal);
      const [prod, useForDebug] = googleStream.tee();

      if (process.env[key] === '1') {
        debugStream(useForDebug).catch();
      }

      // Convert the response into a friendly text-stream
      const pricing = await getModelPricing(model, this.provider);

      const Stream = this.isVertexAi ? VertexAIStream : GoogleGenerativeAIStream;
      const stream = Stream(prod, {
        callbacks: options?.callback,
        inputStartAt,
        payload: { model, pricing, provider: this.provider },
      });

      // Respond with the stream
      return StreamingResponse(stream, { headers: options?.headers });
    } catch (e) {
      const err = e as Error;

      // Remove previous silent handling, throw error uniformly
      if (isAbortError(err)) {
        log('Request was cancelled');
        throw AgentRuntimeError.chat({
          error: { message: 'Request was cancelled' },
          errorType: AgentRuntimeErrorType.ProviderBizError,
          provider: this.provider,
        });
      }

      log('Error: %O', err);
      const { errorType, error } = parseGoogleErrorMessage(err.message);

      throw AgentRuntimeError.chat({ error, errorType, provider: this.provider });
    }
  }

  /**
   * Generate images using Google AI Imagen API or Gemini Chat Models
   * @see https://ai.google.dev/gemini-api/docs/image-generation#imagen
   */
  async createImage(payload: CreateImagePayload): Promise<CreateImageResponse> {
    return createGoogleImage(this.client, this.provider, payload);
  }

  /**
   * Generate structured output using Google Gemini API
   * @see https://ai.google.dev/gemini-api/docs/structured-output
   * @see https://ai.google.dev/gemini-api/docs/function-calling
   */
  async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    // Convert OpenAI messages to Google format
    const contents = await buildGoogleMessages(payload.messages);

    // Handle tools-based structured output
    if (payload.tools && payload.tools.length > 0) {
      return createGoogleGenerateObjectWithTools(
        this.client,
        { contents, model: payload.model, tools: payload.tools },
        options,
      );
    }

    // Handle schema-based structured output
    if (payload.schema) {
      return createGoogleGenerateObject(
        this.client,
        { contents, model: payload.model, schema: payload.schema },
        options,
      );
    }

    return undefined;
  }

  private createEnhancedStream(originalStream: any, signal: AbortSignal): ReadableStream {
    // capture provider for error payloads inside the stream closure
    const provider = this.provider;
    return new ReadableStream({
      async start(controller) {
        let hasData = false;

        try {
          for await (const chunk of originalStream) {
            if (signal.aborted) {
              // If data has already been output, close the stream gracefully instead of throwing an error
              if (hasData) {
                log('Stream cancelled gracefully, preserving existing output');
                // Explicitly inject cancellation error to avoid SSE fallback unexpected_end
                controller.enqueue({
                  [LOBE_ERROR_KEY]: {
                    body: { name: 'Stream cancelled', provider, reason: 'aborted' },
                    message: 'Stream cancelled',
                    name: 'Stream cancelled',
                    type: AgentRuntimeErrorType.StreamChunkError,
                  },
                });
                controller.close();
                return;
              } else {
                // If no data has been output yet, close the stream directly and let downstream SSE emit error event during flush phase
                log('Stream cancelled before any output');
                controller.close();
                return;
              }
            }

            hasData = true;
            controller.enqueue(chunk);
          }
        } catch (error) {
          const err = error as Error;

          // Handle all errors uniformly, including abort errors
          if (isAbortError(err) || signal.aborted) {
            // If data has already been output, close the stream gracefully
            if (hasData) {
              log('Stream reading cancelled gracefully, preserving existing output');
              // Explicitly inject cancellation error to avoid SSE fallback unexpected_end
              controller.enqueue({
                [LOBE_ERROR_KEY]: {
                  body: { name: 'Stream cancelled', provider, reason: 'aborted' },
                  message: 'Stream cancelled',
                  name: 'Stream cancelled',
                  type: AgentRuntimeErrorType.StreamChunkError,
                },
              });
              controller.close();
              return;
            } else {
              log('Stream reading cancelled before any output');
              // Inject an error marker with detailed error information to be handled by downstream google-ai transformer to output error event
              controller.enqueue({
                [LOBE_ERROR_KEY]: {
                  body: {
                    message: err.message,
                    name: 'AbortError',
                    provider,
                    stack: err.stack,
                  },
                  message: err.message || 'Request was cancelled',
                  name: 'AbortError',
                  type: AgentRuntimeErrorType.StreamChunkError,
                },
              });
              controller.close();
              return;
            }
          } else {
            // Handle other stream parsing errors
            log('Stream parsing error: %O', err);
            // Try to parse Google error and extract code/message/status
            const { error: parsedError, errorType } = parseGoogleErrorMessage(
              err?.message || String(err),
            );

            // Inject an error marker with detailed error information to be handled by downstream google-ai transformer to output error event
            controller.enqueue({
              [LOBE_ERROR_KEY]: {
                body: { ...parsedError, provider },
                message: parsedError?.message || err.message || 'Stream parsing error',
                name: 'Stream parsing error',
                type: errorType ?? AgentRuntimeErrorType.StreamChunkError,
              },
            });
            controller.close();
            return;
          }
        }

        controller.close();
      },
    });
  }

  async models(options?: { signal?: AbortSignal }) {
    try {
      const url = `${this.baseURL}/v1beta/models?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'GET',
        signal: options?.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();

      const modelList: GoogleModelCard[] = json.models;

      const processedModels = modelList.map((model) => {
        const id = model.name.replace(/^models\//, '');

        return {
          contextWindowTokens: (model.inputTokenLimit || 0) + (model.outputTokenLimit || 0),
          displayName: model.displayName || id,
          id,
          maxOutput: model.outputTokenLimit || undefined,
        };
      });

      const { MODEL_LIST_CONFIGS, processModelList } = await import('../../utils/modelParse');

      return processModelList(processedModels, MODEL_LIST_CONFIGS.google, 'google');
    } catch (error) {
      log('Failed to fetch Google models: %O', error);
      throw error;
    }
  }

  private buildPayload(payload: ChatStreamPayload) {
    const system_message = payload.messages.find((m) => m.role === 'system');
    const user_messages = payload.messages.filter((m) => m.role !== 'system');

    return {
      ...payload,
      messages: user_messages,
      system: system_message?.content,
    };
  }

  private buildGoogleToolsWithSearch(
    tools: ChatCompletionTool[] | undefined,
    payload?: ChatStreamPayload,
  ): GoogleFunctionCallTool[] | undefined {
    const hasToolCalls = payload?.messages?.some((m) => m.tool_calls?.length);
    const hasSearch = payload?.enabledSearch;
    const hasUrlContext = payload?.urlContext;
    const hasFunctionTools = tools && tools.length > 0;

    // If tool_calls already exist, prioritize handling function declarations
    if (hasToolCalls && hasFunctionTools) {
      return buildGoogleTools(tools);
    }

    // Build and return search-related tools (search tools cannot be used with FunctionCall simultaneously)
    if (hasUrlContext && hasSearch) {
      return [{ urlContext: {} }, { googleSearch: {} }];
    }
    if (hasUrlContext) {
      return [{ urlContext: {} }];
    }
    if (hasSearch) {
      return [{ googleSearch: {} }];
    }

    // Finally consider function declarations
    return buildGoogleTools(tools);
  }
}

export default LobeGoogleAI;
