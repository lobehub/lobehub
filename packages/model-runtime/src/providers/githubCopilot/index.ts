import Anthropic from '@anthropic-ai/sdk';
import { type ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import { responsesAPIModels } from '../../const/models';
import { buildDefaultAnthropicPayload } from '../../core/anthropicCompatibleFactory';
import { type LobeRuntimeAI } from '../../core/BaseAI';
import {
  convertOpenAIMessages,
  convertOpenAIResponseInputs,
  pruneReasoningPayload,
} from '../../core/contextBuilders/openai';
import { transformResponseAPIToStream } from '../../core/openaiCompatibleFactory';
import { AnthropicStream, OpenAIResponsesStream, OpenAIStream } from '../../core/streams';
import { type ChatMethodOptions, type ChatStreamPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { debugResponse, debugStream } from '../../utils/debugStream';
import { getModelPricing } from '../../utils/getModelPricing';
import { StreamingResponse } from '../../utils/response';

const COPILOT_BASE_URL = 'https://api.githubcopilot.com';
const TOKEN_EXCHANGE_URL = 'https://api.github.com/copilot_internal/v2/token';

const MAX_TOTAL_ATTEMPTS = 5;
const MAX_RATE_LIMIT_RETRIES = 3;

const debugParams = {
  chatCompletion: () => process.env.DEBUG_GITHUBCOPILOT_CHAT_COMPLETION === '1',
  responses: () => process.env.DEBUG_GITHUBCOPILOT_RESPONSES === '1',
};

interface CachedToken {
  expiresAt: number;
  token: string;
}

class CopilotTokenManager {
  private cache = new Map<string, CachedToken>();
  private pendingRefresh = new Map<string, Promise<string>>();

  async getToken(githubToken: string): Promise<string> {
    const cacheKey = this.hashToken(githubToken);
    const cached = this.cache.get(cacheKey);

    // Check if cache is valid (refresh 5 minutes early)
    if (cached && Date.now() < cached.expiresAt - 300_000) {
      return cached.token;
    }

    // Avoid concurrent refresh for the same PAT
    const pending = this.pendingRefresh.get(cacheKey);
    if (pending) return pending;

    const refreshPromise = this.exchangeToken(githubToken, cacheKey);
    this.pendingRefresh.set(cacheKey, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      this.pendingRefresh.delete(cacheKey);
    }
  }

  invalidate(githubToken: string): void {
    const cacheKey = this.hashToken(githubToken);
    this.cache.delete(cacheKey);
  }

  private hashToken(token: string): string {
    // Simple hash using last 8 characters to avoid storing full token
    return token.slice(-8);
  }

  private async exchangeToken(githubToken: string, cacheKey: string): Promise<string> {
    const response = await fetch(TOKEN_EXCHANGE_URL, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Token ${githubToken}`,
        'User-Agent': 'LobeChat/1.0',
      },
      method: 'GET',
    });

    if (response.status === 401) {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidGithubCopilotToken, {
        message: 'Invalid GitHub Personal Access Token',
      });
    }
    if (response.status === 403) {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.PermissionDenied, {
        message: 'No GitHub Copilot subscription or access denied',
      });
    }
    if (!response.ok) {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
        message: `Token exchange failed: ${response.status} ${response.statusText}`,
      });
    }

    const data = await response.json();
    if (!data?.token || typeof data.expires_at !== 'number') {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
        message: 'Invalid token response format',
      });
    }

    this.cache.set(cacheKey, {
      expiresAt: data.expires_at * 1000,
      token: data.token,
    });

    return data.token;
  }
}

// Singleton token manager
const tokenManager = new CopilotTokenManager();

export interface LobeGithubCopilotAIParams {
  apiKey?: string;
  /**
   * Cached bearer token from previous OAuth exchange
   */
  bearerToken?: string;
  /**
   * Bearer token expiration timestamp (ms)
   */
  bearerTokenExpiresAt?: number;
  /**
   * OAuth access token (e.g., GitHub's ghu_xxx)
   */
  oauthAccessToken?: string;
}

export class LobeGithubCopilotAI implements LobeRuntimeAI {
  baseURL = COPILOT_BASE_URL;
  private cachedBearerToken?: string;
  private githubToken: string;

  constructor({
    apiKey,
    oauthAccessToken,
    bearerToken,
    bearerTokenExpiresAt,
  }: LobeGithubCopilotAIParams = {}) {
    // Priority 1: Use cached bearer token if still valid (refresh 5 minutes early)
    if (bearerToken && bearerTokenExpiresAt && Date.now() < bearerTokenExpiresAt - 300_000) {
      this.cachedBearerToken = bearerToken;
      this.githubToken = oauthAccessToken || apiKey || '';
    }
    // Priority 2: Use OAuth access token for exchange
    else if (oauthAccessToken) {
      this.githubToken = oauthAccessToken;
    }
    // Priority 3: Use traditional PAT
    else if (apiKey) {
      this.githubToken = apiKey;
    } else {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidGithubCopilotToken, {
        message: 'GitHub Personal Access Token or OAuth token is required',
      });
    }
  }

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    return this.executeWithRetry(async () => {
      const inputStartAt = Date.now();

      // Use cached bearer token if available, otherwise exchange
      const bearerToken = this.cachedBearerToken || (await tokenManager.getToken(this.githubToken));

      const { model, ...rest } = this.handlePayload(payload);
      const shouldStream = rest.stream !== false;

      if (model.toLowerCase().includes('claude')) {
        const anthropicClient = new Anthropic({
          apiKey: bearerToken,
          baseURL: this.baseURL,
          defaultHeaders: {
            'Authorization': `Bearer ${bearerToken}`,
            'Copilot-Integration-Id': 'vscode-chat',
            'Editor-Plugin-Version': 'LobeChat/1.0',
            'Editor-Version': 'LobeChat/1.0',
            'anthropic-version': '2023-06-01',
          },
        });

        const anthropicPayload = await buildDefaultAnthropicPayload({
          ...(rest as ChatStreamPayload),
          model,
        });

        const finalPayload = { ...anthropicPayload, stream: shouldStream };

        if (debugParams.chatCompletion()) {
          // eslint-disable-next-line no-console
          console.log('[requestPayload]');
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(finalPayload), '\n');
        }

        const response = await anthropicClient.messages.create(
          {
            ...finalPayload,
            metadata: options?.user ? { user_id: options.user } : undefined,
          },
          {
            headers: options?.requestHeaders,
            signal: options?.signal,
          },
        );

        const pricing = await getModelPricing(model, ModelProvider.GithubCopilot);

        const streamResponse = response as any;
        const [prod, useForDebug] = streamResponse.tee();

        if (debugParams.chatCompletion()) {
          const useForDebugStream =
            useForDebug instanceof ReadableStream ? useForDebug : useForDebug.toReadableStream();

          debugStream(useForDebugStream).catch(console.error);
        }

        return StreamingResponse(
          AnthropicStream(prod, {
            callbacks: options?.callback,
            inputStartAt,
            payload: {
              model,
              pricing,
              provider: ModelProvider.GithubCopilot,
            },
          }),
          { headers: options?.headers },
        );
      }

      const client = new OpenAI({
        apiKey: bearerToken,
        baseURL: COPILOT_BASE_URL,
        defaultHeaders: {
          'Copilot-Integration-Id': 'vscode-chat',
          'Editor-Plugin-Version': 'LobeChat/1.0',
          'Editor-Version': 'LobeChat/1.0',
        },
      });

      if (
        responsesAPIModels.has(model) ||
        model.toLowerCase().includes('oswe') ||
        (payload as any).apiMode === 'responses'
      ) {
        const {
          messages,
          reasoning_effort,
          tools,
          reasoning,
          max_tokens,
          verbosity,
          ...responseRest
        } = rest as any;

        delete responseRest.apiMode;
        delete responseRest.frequency_penalty;
        delete responseRest.presence_penalty;

        const input = await convertOpenAIResponseInputs(messages as any, {
          forceImageBase64: true,
          strictToolPairing: true,
        });

        const responseTools = tools?.map(this.convertChatCompletionToolToResponseTool);
        const responsePayload = {
          ...responseRest,
          ...(reasoning || reasoning_effort
            ? {
                reasoning: {
                  ...reasoning,
                  ...(reasoning_effort && { effort: reasoning_effort }),
                  summary: 'detailed',
                },
              }
            : {}),
          ...(max_tokens && { max_output_tokens: max_tokens }),
          text: verbosity ? { verbosity } : undefined,
          input,
          model,
          stream: shouldStream,
          ...(responseTools ? { tools: responseTools } : {}),
        };

        if (debugParams.responses()) {
          // eslint-disable-next-line no-console
          console.log('[requestPayload]');
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(responsePayload), '\n');
        }

        const response = await client.responses.create(responsePayload, {
          signal: options?.signal,
        });

        if (shouldStream) {
          const stream = response as any;
          const [prod, useForDebug] = stream.tee();

          if (debugParams.responses()) {
            const useForDebugStream =
              useForDebug instanceof ReadableStream ? useForDebug : useForDebug.toReadableStream();

            debugStream(useForDebugStream).catch(console.error);
          }

          return StreamingResponse(
            OpenAIResponsesStream(prod, {
              callbacks: options?.callback,
              payload: { model, provider: ModelProvider.GithubCopilot },
            }),
            { headers: options?.headers },
          );
        }

        const responseStream = transformResponseAPIToStream(response as OpenAI.Responses.Response);

        if (debugParams.responses()) {
          debugResponse(response);
        }

        return StreamingResponse(
          OpenAIResponsesStream(responseStream, {
            callbacks: options?.callback,
            enableStreaming: false,
            payload: { model, provider: ModelProvider.GithubCopilot },
          }),
          { headers: options?.headers },
        );
      }

      const { apiMode: _, ...cleanedRest } = rest as any;
      const messages = await convertOpenAIMessages(cleanedRest.messages as any, {
        forceImageBase64: true,
      });

      const chatCompletionPayload = {
        ...cleanedRest,
        messages,
        model,
        stream: shouldStream,
      } as OpenAI.ChatCompletionCreateParamsStreaming;

      if (debugParams.chatCompletion()) {
        // eslint-disable-next-line no-console
        console.log('[requestPayload]');
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(chatCompletionPayload), '\n');
      }

      let response = await client.chat.completions.create(chatCompletionPayload, {
        signal: options?.signal,
      });

      if (shouldStream && debugParams.chatCompletion()) {
        const [prod, useForDebug] = (response as any).tee();
        const useForDebugStream =
          useForDebug instanceof ReadableStream ? useForDebug : useForDebug.toReadableStream();

        debugStream(useForDebugStream).catch(console.error);
        response = prod;
      }

      if (!shouldStream && debugParams.chatCompletion()) {
        debugResponse(response);
      }

      return StreamingResponse(
        OpenAIStream(response, {
          callbacks: options?.callback,
          payload: { model, provider: ModelProvider.GithubCopilot },
        }),
        { headers: options?.headers },
      );
    });
  }

  async models(): Promise<ChatModelCard[]> {
    return this.executeWithRetry(async () => {
      const bearerToken = this.cachedBearerToken || (await tokenManager.getToken(this.githubToken));

      const response = await fetch(`${COPILOT_BASE_URL}/models`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${bearerToken}`,
          'Copilot-Integration-Id': 'vscode-chat',
          'Editor-Plugin-Version': 'LobeChat/1.0',
          'Editor-Version': 'LobeChat/1.0',
        },
        method: 'GET',
      });

      if (!response.ok) {
        throw { status: response.status };
      }

      const data = await response.json();

      // Transform Copilot models to ChatModelCard format
      return (data.models || data.data || []).map((model: any) => ({
        displayName: model.name || model.id,
        enabled: true,
        id: model.id || model.name,
        type: 'chat',
      }));
    });
  }

  private handlePayload(payload: ChatStreamPayload) {
    const { model } = payload;

    // Reasoning models: disable stream, prune unsupported params
    if (model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
      return { ...pruneReasoningPayload(payload), stream: false };
    }

    return { ...payload, stream: true };
  }

  private convertChatCompletionToolToResponseTool = (tool: any): OpenAI.Responses.Tool => {
    return { type: tool.type, ...tool.function } as any;
  };

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let totalAttempts = 0;
    let hasRefreshedAuth = false;
    let rateLimitAttempts = 0;

    while (totalAttempts < MAX_TOTAL_ATTEMPTS) {
      totalAttempts++;

      try {
        return await fn();
      } catch (error: any) {
        const status = error?.status ?? error?.error?.status ?? error?.response?.status;

        // 401: Refresh token once (only if we have an exchange credential to fall back to)
        if (status === 401 && !hasRefreshedAuth && this.githubToken) {
          hasRefreshedAuth = true;
          this.cachedBearerToken = undefined;
          tokenManager.invalidate(this.githubToken);
          continue;
        }

        // 429: Rate limit retry with exponential backoff
        if (status === 429 && rateLimitAttempts < MAX_RATE_LIMIT_RETRIES) {
          rateLimitAttempts++;
          const retryAfter = this.getRetryAfterMs(error) ?? 1000 * Math.pow(2, rateLimitAttempts);

          await new Promise<void>((resolve) => {
            setTimeout(resolve, Math.min(retryAfter, 10_000));
          });
          continue;
        }

        // Map and throw
        throw this.mapError(error);
      }
    }

    throw AgentRuntimeError.chat({
      endpoint: this.baseURL,
      error: { message: 'Max retry attempts exceeded' },
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: ModelProvider.GithubCopilot,
    });
  }

  private getRetryAfterMs(error: any): number | undefined {
    const header = error?.response?.headers?.get?.('Retry-After');
    if (header) {
      const seconds = parseInt(header, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
    return undefined;
  }

  private mapError(error: any) {
    const status = error?.status ?? error?.error?.status;

    switch (status) {
      case 401: {
        return AgentRuntimeError.chat({
          endpoint: this.baseURL,
          error,
          errorType: AgentRuntimeErrorType.InvalidGithubCopilotToken,
          provider: ModelProvider.GithubCopilot,
        });
      }
      case 403: {
        return AgentRuntimeError.chat({
          endpoint: this.baseURL,
          error,
          errorType: AgentRuntimeErrorType.PermissionDenied,
          provider: ModelProvider.GithubCopilot,
        });
      }
      case 429: {
        return AgentRuntimeError.chat({
          endpoint: this.baseURL,
          error,
          errorType: AgentRuntimeErrorType.QuotaLimitReached,
          provider: ModelProvider.GithubCopilot,
        });
      }
      default: {
        return AgentRuntimeError.chat({
          endpoint: this.baseURL,
          error,
          errorType: AgentRuntimeErrorType.ProviderBizError,
          provider: ModelProvider.GithubCopilot,
        });
      }
    }
  }
}

export default LobeGithubCopilotAI;
