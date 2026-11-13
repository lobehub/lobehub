import { AgentRuntimeErrorType } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { CheckCredentialsResult } from '../../types/credentials';
import type {
  CreateMusicOptions,
  CreateMusicPayload,
  PollMusicStatusOptions,
} from '../../types/music';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { createSunoMusic, pollSunoMusicStatus } from './createMusic';

export const SUNO_DEFAULT_BASE_URL = 'https://api.sunoapi.org';

const API_V1_SUFFIX = '/api/v1';

/**
 * Suno gateways speak two dialects: sunoapi.org (`/api/v1/generate` +
 * `/api/v1/generate/record-info`, camelCase), which generation and polling implement, and
 * kie.ai's jobs API (`/api/v1/jobs/createTask` + `/api/v1/jobs/recordInfo`, snake_case
 * input), which they do not implement yet. A kie.ai host is detected and rejected with a clear
 * error instead of passing the key check and then failing every generation; any other host is
 * treated as sunoapi.org-compatible.
 */
export type SunoGatewayDialect = 'kie' | 'sunoapi';

/**
 * Credit endpoint of the sunoapi.org dialect. It is free and generates nothing, so the
 * settings checker uses it to verify the key.
 * @see https://docs.sunoapi.org/suno-api/get-remaining-credits
 */
/** A credit lookup is a single small GET; give up well before the request's own deadline. */
const CHECK_TIMEOUT_MS = 15_000;

const CREDIT_PATH = '/api/v1/generate/credit';

/**
 * Gateways answer HTTP 200 with the real status in `code`, e.g.
 * `{"code":401,"msg":"Unauthorized – Authentication failed. ..."}`.
 */
interface SunoGatewayResponse<T> {
  code?: number;
  data?: T;
  msg?: string;
}

/** Strip trailing slashes and an `/api/v1` suffix so both `https://api.sunoapi.org` and `.../api/v1` work. */
export const normalizeSunoBaseURL = (baseURL?: string | null) => {
  // Plain string trimming instead of a `/\/+$/` regex, which backtracks polynomially on user input.
  let url = baseURL?.trim() || SUNO_DEFAULT_BASE_URL;
  while (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith(API_V1_SUFFIX)) url = url.slice(0, -API_V1_SUFFIX.length);

  return url;
};

export const resolveSunoGatewayDialect = (baseURL: string): SunoGatewayDialect => {
  try {
    const { hostname } = new URL(baseURL);
    return hostname === 'kie.ai' || hostname.endsWith('.kie.ai') ? 'kie' : 'sunoapi';
  } catch {
    return 'sunoapi';
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

export interface LobeSunoAIParams extends ModelIdMappingOptions {
  apiKey?: string;
  baseURL?: string | null;
  /** Provider id for error payloads; custom providers pass their own id. */
  id?: string;
}

/**
 * Suno music generation through a third-party gateway. Suno is music-only, so the runtime
 * implements `createMusic`, its task polling and the settings-page credential check.
 */
export class LobeSunoAI implements LobeRuntimeAI {
  baseURL: string;
  readonly dialect: SunoGatewayDialect;
  private apiKey: string;
  private id: string;
  private modelIdMapping?: ModelIdMappingOptions['modelIdMapping'];

  constructor({ apiKey, baseURL, id, modelIdMapping }: LobeSunoAIParams = {}) {
    if (!apiKey?.trim())
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey.trim();
    this.baseURL = normalizeSunoBaseURL(baseURL);
    this.dialect = resolveSunoGatewayDialect(this.baseURL);
    this.id = id || ModelProvider.Suno;
    this.modelIdMapping = modelIdMapping;
  }

  async createMusic(payload: CreateMusicPayload, options?: CreateMusicOptions) {
    this.assertSupportedGateway();

    return createSunoMusic(payload, {
      ...options,
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      modelIdMapping: this.modelIdMapping,
      provider: this.id,
    });
  }

  async handlePollMusicStatus(
    inferenceId: string,
    _model?: string,
    _route?: unknown,
    options?: PollMusicStatusOptions,
  ) {
    this.assertSupportedGateway();

    return pollSunoMusicStatus(inferenceId, {
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      provider: this.id,
      signal: options?.signal,
    });
  }

  async checkCredentials(): Promise<CheckCredentialsResult> {
    // Fail the settings check up front: a kie.ai key would pass its credit endpoint and then
    // fail every generation, because generation only speaks the sunoapi.org dialect.
    this.assertSupportedGateway();

    const url = `${this.baseURL}${CREDIT_PATH}`;

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

  /** kie.ai's jobs API is a different protocol; reject it instead of calling the wrong routes. */
  private assertSupportedGateway() {
    if (this.dialect === 'kie') {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
        message: `kie.ai's Suno API (/api/v1/jobs/createTask) is not supported yet. Use a sunoapi.org key, or a gateway compatible with sunoapi.org's /api/v1/generate, as the proxy URL (${this.baseURL}).`,
        provider: this.id,
      });
    }
  }
}

export default LobeSunoAI;
