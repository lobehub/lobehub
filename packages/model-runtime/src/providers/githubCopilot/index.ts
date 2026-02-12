import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { pruneReasoningPayload } from '../../core/contextBuilders/openai';
import { OpenAIStream } from '../../core/streams';
import type { ChatMethodOptions, ChatStreamPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { StreamingResponse } from '../../utils/response';

const COPILOT_BASE_URL = 'https://api.githubcopilot.com';
const TOKEN_EXCHANGE_URL = 'https://api.github.com/copilot_internal/v2/token';

const MAX_TOTAL_ATTEMPTS = 5;
const MAX_AUTH_REFRESH = 1;
const MAX_RATE_LIMIT_RETRIES = 3;

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
      // Use cached bearer token if available, otherwise exchange
      const bearerToken = this.cachedBearerToken || (await tokenManager.getToken(this.githubToken));

      const client = new OpenAI({
        apiKey: bearerToken,
        baseURL: COPILOT_BASE_URL,
        defaultHeaders: {
          'Copilot-Integration-Id': 'vscode-chat',
          'Editor-Plugin-Version': 'LobeChat/1.0',
          'Editor-Version': 'LobeChat/1.0',
        },
      });

      const { model, ...rest } = this.handlePayload(payload);
      const shouldStream = rest.stream !== false;

      const response = await client.chat.completions.create(
        { ...rest, model, stream: shouldStream } as OpenAI.ChatCompletionCreateParamsStreaming,
        { signal: options?.signal },
      );

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

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let totalAttempts = 0;
    let authRefreshAttempts = 0;
    let rateLimitAttempts = 0;

    while (totalAttempts < MAX_TOTAL_ATTEMPTS) {
      totalAttempts++;

      try {
        return await fn();
      } catch (error: any) {
        const status = error?.status ?? error?.error?.status ?? error?.response?.status;

        // 401: Refresh token once
        if (status === 401 && authRefreshAttempts < MAX_AUTH_REFRESH) {
          authRefreshAttempts++;
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
