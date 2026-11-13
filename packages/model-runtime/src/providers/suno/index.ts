import { AgentRuntimeErrorType } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { CheckCredentialsResult } from '../../types/credentials';
import { AgentRuntimeError } from '../../utils/createError';

export const SUNO_DEFAULT_BASE_URL = 'https://api.kie.ai';

/**
 * Suno gateways speak one protocol in two dialects: kie.ai (`/api/v1/jobs/createTask`,
 * snake_case input) and sunoapi.org (`/api/v1/generate`, camelCase). The host picks the
 * dialect; anything that is not sunoapi.org is treated as kie.ai-compatible.
 */
export type SunoGatewayDialect = 'kie' | 'sunoapi';

/**
 * Credit endpoint per dialect. It is free and generates nothing, so the settings checker
 * uses it to verify the key.
 * @see https://docs.kie.ai/common-api/get-account-credits
 * @see https://docs.sunoapi.org/suno-api/get-remaining-credits
 */
/** A credit lookup is a single small GET; give up well before the request's own deadline. */
const CHECK_TIMEOUT_MS = 15_000;

const CREDIT_PATHS: Record<SunoGatewayDialect, string> = {
  kie: '/api/v1/chat/credit',
  sunoapi: '/api/v1/generate/credit',
};

/**
 * Gateways answer HTTP 200 with the real status in `code`, e.g.
 * `{"code":401,"msg":"Unauthorized – Authentication failed. ..."}`.
 */
interface SunoGatewayResponse<T> {
  code?: number;
  data?: T;
  msg?: string;
}

/** Strip trailing slashes and an `/api/v1` suffix so both `https://api.kie.ai` and `.../api/v1` work. */
export const normalizeSunoBaseURL = (baseURL?: string | null) =>
  (baseURL?.trim() || SUNO_DEFAULT_BASE_URL).replace(/\/+$/, '').replace(/\/api\/v1$/, '');

export const resolveSunoGatewayDialect = (baseURL: string): SunoGatewayDialect => {
  try {
    const { hostname } = new URL(baseURL);
    return hostname === 'sunoapi.org' || hostname.endsWith('.sunoapi.org') ? 'sunoapi' : 'kie';
  } catch {
    return 'kie';
  }
};

const errorTypeForGatewayCode = (code: number | undefined) => {
  switch (code) {
    case 401:
    case 403: {
      return AgentRuntimeErrorType.InvalidProviderAPIKey;
    }
    case 402: {
      return AgentRuntimeErrorType.InsufficientQuota;
    }
    default: {
      return AgentRuntimeErrorType.ProviderBizError;
    }
  }
};

export interface LobeSunoAIParams {
  apiKey?: string;
  baseURL?: string | null;
  /** Provider id for error payloads; custom providers pass their own id. */
  id?: string;
}

/**
 * Suno music generation through a third-party gateway.
 *
 * This runtime currently implements the credential check used by the provider settings
 * page; music generation (`createMusic` / polling) is added with the music generation chain.
 */
export class LobeSunoAI implements LobeRuntimeAI {
  baseURL: string;
  readonly dialect: SunoGatewayDialect;
  private apiKey: string;
  private id: string;

  constructor({ apiKey, baseURL, id }: LobeSunoAIParams = {}) {
    if (!apiKey?.trim())
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey.trim();
    this.baseURL = normalizeSunoBaseURL(baseURL);
    this.dialect = resolveSunoGatewayDialect(this.baseURL);
    this.id = id || ModelProvider.Suno;
  }

  async checkCredentials(): Promise<CheckCredentialsResult> {
    const url = `${this.baseURL}${CREDIT_PATHS[this.dialect]}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        method: 'GET',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
    } catch (error) {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
        message: (error as Error)?.message || 'Failed to reach the Suno gateway',
        provider: this.id,
      });
    }

    let body: SunoGatewayResponse<unknown> | undefined;
    try {
      body = (await response.json()) as SunoGatewayResponse<unknown>;
    } catch {
      body = undefined;
    }

    // The gateway status lives in `code`; fall back to the HTTP status only for an HTTP error.
    // A 200 without a gateway body (e.g. an HTML page behind a wrong proxy URL) is not a pass.
    const gatewayCode = typeof body?.code === 'number' ? body.code : undefined;
    if (response.ok && gatewayCode === undefined) {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
        message: `The proxy URL did not answer like a Suno gateway (${this.baseURL})`,
        provider: this.id,
      });
    }
    const code = gatewayCode ?? response.status;

    if (!response.ok || code !== 200) {
      throw AgentRuntimeError.createError(errorTypeForGatewayCode(code), {
        code,
        message: body?.msg || response.statusText || `Suno gateway returned ${code}`,
        provider: this.id,
      });
    }

    return typeof body?.data === 'number' ? { balance: body.data } : {};
  }
}

export default LobeSunoAI;
