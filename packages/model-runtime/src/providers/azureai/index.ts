import type { Readable as NodeReadable } from 'node:stream';

import { AzureKeyCredential } from '@azure/core-auth';
import type { ModelClient } from '@azure-rest/ai-inference';
import createClient from '@azure-rest/ai-inference';
import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { transformResponseToStream } from '../../core/openaiCompatibleFactory';
import {
  appendProviderResponseEvent,
  appendRawProviderEvent,
  finalizeProviderResponse,
  initializeProviderDiagnostics,
  observeProviderReadableStream,
  recordProviderError,
} from '../../core/providerDiagnostics';
import { createSSEDataExtractor, OpenAIStream } from '../../core/streams';
import type { ChatMethodOptions, ChatStreamPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { debugStream } from '../../utils/debugStream';
import { StreamingResponse } from '../../utils/response';
import { sanitizeError } from '../../utils/sanitizeError';
import { systemToUserModels } from '../openai/modelId';
import { createAzureAIStreamChunkRecorder } from './providerDiagnostics';

interface AzureAIParams {
  apiKey?: string;
  apiVersion?: string;
  baseURL?: string;
}

export class LobeAzureAI implements LobeRuntimeAI {
  client: ModelClient;

  constructor(params?: AzureAIParams) {
    if (!params?.apiKey || !params?.baseURL)
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.client = createClient(params?.baseURL, new AzureKeyCredential(params?.apiKey));

    this.baseURL = params?.baseURL;
  }

  baseURL: string;

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    // Remove internal apiMode parameter to prevent sending to Azure AI API

    const {
      messages,
      model,
      temperature,
      top_p,
      apiMode: _,
      preserveThinking: _pt,
      ...params
    } = payload;
    // o1 series models on Azure OpenAI does not support streaming currently
    const enableStreaming = model.includes('o1') ? false : (params.stream ?? true);

    const updatedMessages = messages.map((message) => ({
      ...message,
      role:
        // Convert 'system' role to 'user' or 'developer' based on the model
        (model.includes('o1') || model.includes('o3')) && message.role === 'system'
          ? [...systemToUserModels].some((sub) => model.includes(sub))
            ? 'user'
            : 'developer'
          : message.role,
    }));
    const requestBody = {
      messages: updatedMessages as OpenAI.ChatCompletionMessageParam[],
      model,
      ...params,
      stream: enableStreaming,
      temperature: model.includes('o3') || model.includes('o4') ? undefined : temperature,
      tool_choice: params.tools ? 'auto' : undefined,
      top_p: model.includes('o3') || model.includes('o4') ? undefined : top_p,
    };
    const providerResponseDiagnostics = initializeProviderDiagnostics({
      apiMode: 'azure_ai_chat_completions',
      diagnostics: options?.diagnostics,
      endpoint: this.maskSensitiveUrl(this.baseURL),
      payload: requestBody,
      sentAt: Date.now(),
    });

    try {
      const response = this.client.path('/chat/completions').post({
        body: requestBody,
      });

      if (enableStreaming) {
        const unifiedStream = await (async () => {
          if (typeof window === 'undefined') {
            /**
             * In Node.js the SDK exposes a Node readable stream, so we convert it to a Web ReadableStream
             * to reuse the same streaming pipeline used by Edge/browser runtimes.
             */
            const streamModule = await import('node:stream');
            const Readable = streamModule.Readable ?? streamModule.default.Readable;

            if (!Readable) throw new Error('node:stream module missing Readable export');
            if (typeof Readable.toWeb !== 'function')
              throw new Error('Readable.toWeb is not a function');

            const nodeResponse = await response.asNodeStream();
            const nodeStream = nodeResponse.body;

            if (!nodeStream) {
              throw new Error('Azure AI response body is empty');
            }

            return Readable.toWeb(nodeStream as unknown as NodeReadable) as ReadableStream;
          }

          const browserResponse = await response.asBrowserStream();
          const browserStream = browserResponse.body;

          if (!browserStream) {
            throw new Error('Azure AI response body is empty');
          }

          return browserStream;
        })();

        const observedStream = observeProviderReadableStream(
          unifiedStream,
          providerResponseDiagnostics,
          createAzureAIStreamChunkRecorder(),
          options?.signal,
        );
        let prod = observedStream;

        if (process.env.DEBUG_AZURE_AI_CHAT_COMPLETION === '1') {
          const [productionStream, debug] = observedStream.tee();
          prod = productionStream;
          debugStream(debug).catch(console.error);
        }

        return StreamingResponse(
          OpenAIStream(prod.pipeThrough(createSSEDataExtractor()), {
            callbacks: options?.callback,
          }),
          {
            headers: options?.headers,
          },
        );
      } else {
        const res = await response;
        if (providerResponseDiagnostics) {
          appendRawProviderEvent(providerResponseDiagnostics, res.body);
          providerResponseDiagnostics.firstEventAt ??= Date.now();
          providerResponseDiagnostics.responseReceivedAt ??= Date.now();
          providerResponseDiagnostics.terminalEventReceived = true;
          appendProviderResponseEvent(providerResponseDiagnostics, {
            type: 'azure_ai_chat_completion',
          });
          await finalizeProviderResponse(providerResponseDiagnostics, options?.signal);
        }

        // the azure AI inference response is openai compatible
        const stream = transformResponseToStream(res.body as OpenAI.ChatCompletion);
        return StreamingResponse(
          OpenAIStream(stream, { callbacks: options?.callback, enableStreaming: false }),
          {
            headers: options?.headers,
          },
        );
      }
    } catch (e) {
      recordProviderError(providerResponseDiagnostics, e);
      await finalizeProviderResponse(providerResponseDiagnostics, options?.signal);
      let error = e as { [key: string]: any; code: string; message: string };

      if (error.code) {
        switch (error.code) {
          case 'DeploymentNotFound': {
            error = { ...error, deployId: model };
          }
        }
      } else {
        error = {
          cause: error.cause,
          message: error.message,
          name: error.name,
        } as any;
      }

      const errorType = error.code
        ? AgentRuntimeErrorType.ProviderBizError
        : AgentRuntimeErrorType.AgentRuntimeError;

      // Sanitize error to remove sensitive information like API keys from headers
      const sanitizedError = sanitizeError(error);

      throw AgentRuntimeError.chat({
        endpoint: this.maskSensitiveUrl(this.baseURL),
        error: sanitizedError,
        errorType,
        provider: ModelProvider.Azure,
      });
    }
  }

  private maskSensitiveUrl = (url: string) => {
    // Use a regex to match the content between 'https://' and '.azure.com/'
    const regex = /^(https:\/\/)([^.]+)(\.cognitiveservices\.azure\.com\/.*)$/;

    // Use a replacement function
    return url.replace(regex, (match, protocol, subdomain, rest) => {
      // Replace the subdomain with '***'
      return `${protocol}***${rest}`;
    });
  };
}
