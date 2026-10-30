import { AgentRuntimeErrorType } from '@lobechat/types';
import createDebug from 'debug';
import type { TTSAudioFormat } from 'model-bank';
import { DEFAULT_TTS_AUDIO_FORMAT } from 'model-bank';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { convertTextToSpeechUsage } from '../../core/usageConverters/tts';
import type { ILobeAgentRuntimeErrorType } from '../../types/error';
import type {
  TextToSpeechOptions,
  TextToSpeechPayload,
  TextToSpeechResponse,
} from '../../types/tts';
import { resolveTextToSpeechParams } from '../../types/tts';
import type { ChatCompletionErrorPayload } from '../../types/type';
import { AgentRuntimeError } from '../../utils/createError';
import { getModelPricing } from '../../utils/getModelPricing';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../utils/modelIdMapping';

const log = createDebug('lobe-tts:minimax');

export interface MiniMaxSpeechOptions extends ModelIdMappingOptions, TextToSpeechOptions {
  apiKey: string;
  /** OpenAI-style API root, e.g. `https://api.minimaxi.com/v1`. */
  baseURL: string;
  /** Provider id used for pricing lookup and error payloads. */
  provider: string;
}

/** Formats t2a_v2 returns for the standard TTS formats; MiniMax has no `aac` output. */
const MINIMAX_AUDIO_FORMATS: Partial<Record<TTSAudioFormat, string>> = {
  flac: 'flac',
  mp3: 'mp3',
  opus: 'opus',
  pcm: 'pcm',
  wav: 'wav',
};

const HEX_PATTERN = /^(?:[\da-f]{2})+$/i;

/**
 * `base_resp.status_code` values that map onto a specific runtime error type; everything
 * else is a provider business error.
 * @see https://platform.minimaxi.com/docs/api-reference/errorcode
 */
const MINIMAX_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  1002: AgentRuntimeErrorType.RateLimitExceeded,
  1004: AgentRuntimeErrorType.InvalidProviderAPIKey,
  1008: AgentRuntimeErrorType.InsufficientQuota,
  1039: AgentRuntimeErrorType.RateLimitExceeded,
  2049: AgentRuntimeErrorType.InvalidProviderAPIKey,
};

const HTTP_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  401: AgentRuntimeErrorType.InvalidProviderAPIKey,
  403: AgentRuntimeErrorType.PermissionDenied,
  429: AgentRuntimeErrorType.RateLimitExceeded,
};

interface MiniMaxBaseResp {
  status_code: number;
  status_msg?: string;
}

interface MiniMaxSpeechResponse {
  base_resp?: MiniMaxBaseResp;
  data?: {
    audio?: string;
    status?: number;
  } | null;
  extra_info?: {
    audio_format?: string;
    audio_length?: number;
    audio_size?: number;
    usage_characters?: number;
  };
  trace_id?: string;
}

/** Thrown inside the request flow and unwrapped into a runtime error payload. */
class MiniMaxSpeechError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const getMiniMaxSpeechErrorType = (statusCode: number): ILobeAgentRuntimeErrorType =>
  MINIMAX_ERROR_TYPES[statusCode] ?? AgentRuntimeErrorType.ProviderBizError;

/**
 * Decode the hex-encoded audio returned by t2a_v2 (`output_format: 'hex'`).
 */
export const decodeMiniMaxHexAudio = (hex: unknown): ArrayBuffer => {
  if (typeof hex !== 'string' || !HEX_PATTERN.test(hex)) {
    throw new MiniMaxSpeechError(
      'MiniMax returned no valid hex audio',
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  const buffer = Buffer.from(hex, 'hex');

  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
};

/**
 * Map the standard TTS payload onto a t2a_v2 request body. Params the caller did not set
 * are omitted so MiniMax applies its own defaults (e.g. automatic emotion).
 */
export const buildMiniMaxSpeechRequest = (
  payload: TextToSpeechPayload,
  requestModel: string,
): { body: Record<string, unknown>; format: TTSAudioFormat } => {
  const params = resolveTextToSpeechParams(payload);
  const format = params.format ?? DEFAULT_TTS_AUDIO_FORMAT;
  const minimaxFormat = MINIMAX_AUDIO_FORMATS[format];

  if (!minimaxFormat) {
    throw new MiniMaxSpeechError(
      `MiniMax speech does not support the "${format}" format`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  return {
    body: {
      audio_setting: {
        channel: 1,
        format: minimaxFormat,
        ...(params.sampleRate !== undefined && { sample_rate: params.sampleRate }),
      },
      model: requestModel,
      output_format: 'hex',
      stream: false,
      text: payload.input,
      voice_setting: {
        voice_id: payload.voice,
        ...(params.speed !== undefined && { speed: params.speed }),
        ...(params.volume !== undefined && { vol: params.volume }),
        ...(params.pitch !== undefined && { pitch: params.pitch }),
        ...(params.emotion && { emotion: params.emotion }),
      },
    },
    format,
  };
};

const readErrorBody = async (response: Response) => {
  try {
    return (await response.json()) as MiniMaxSpeechResponse;
  } catch {
    return undefined;
  }
};

/**
 * Synthesize speech with MiniMax's native `POST /t2a_v2` (not the OpenAI-style
 * `/audio/speech`). Usage is the billed `extra_info.usage_characters`.
 * @see https://platform.minimaxi.com/docs/api-reference/speech-t2a-http
 */
export async function createMiniMaxSpeech(
  payload: TextToSpeechPayload,
  options: MiniMaxSpeechOptions,
): Promise<TextToSpeechResponse> {
  const { apiKey, baseURL, provider } = options;
  const requestModel = resolveMappedModelId(payload.model, options);

  let result: TextToSpeechResponse;
  try {
    const { body, format } = buildMiniMaxSpeechRequest(payload, requestModel);
    const pricing = await getModelPricing(payload.model, provider, options.pricingContext);

    log('t2a_v2 request: model=%s voice=%s format=%s', requestModel, payload.voice, format);

    const response = await fetch(`${baseURL}/t2a_v2`, {
      body: JSON.stringify(body),
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: options.signal,
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      const statusCode = errorBody?.base_resp?.status_code;

      throw new MiniMaxSpeechError(
        `MiniMax API error (${response.status}): ${errorBody?.base_resp?.status_msg || response.statusText}`,
        HTTP_ERROR_TYPES[response.status] ??
          (statusCode ? getMiniMaxSpeechErrorType(statusCode) : undefined) ??
          AgentRuntimeErrorType.ProviderBizError,
        { base_resp: errorBody?.base_resp, status: response.status },
      );
    }

    const data = (await response.json()) as MiniMaxSpeechResponse;
    const baseResp = data.base_resp;

    if (baseResp && baseResp.status_code !== 0) {
      throw new MiniMaxSpeechError(
        `MiniMax API error: ${baseResp.status_msg || baseResp.status_code}`,
        getMiniMaxSpeechErrorType(baseResp.status_code),
        { base_resp: baseResp, trace_id: data.trace_id },
      );
    }

    const audio = decodeMiniMaxHexAudio(data.data?.audio);
    const usageCharacters = data.extra_info?.usage_characters;

    log(
      't2a_v2 done: %d bytes, %d ms, usage_characters=%s, trace_id=%s',
      audio.byteLength,
      data.extra_info?.audio_length,
      usageCharacters,
      data.trace_id,
    );

    const usage = convertTextToSpeechUsage(
      payload.input,
      pricing,
      typeof usageCharacters === 'number' ? { inputCharacters: usageCharacters } : undefined,
    );

    result = { audio, format, usage };
  } catch (error) {
    log('createMiniMaxSpeech error: %O', error);

    if ((error as Error)?.name === 'AbortError') throw error;

    const errorType =
      error instanceof MiniMaxSpeechError
        ? error.errorType
        : AgentRuntimeErrorType.ProviderBizError;

    throw AgentRuntimeError.chat({
      error: {
        message: (error as Error)?.message ?? String(error),
        ...(error instanceof MiniMaxSpeechError ? error.detail : undefined),
      },
      errorType,
      provider,
    } satisfies ChatCompletionErrorPayload);
  }

  await options.onUsage?.(result.usage!);

  return result;
}

/**
 * Speech-only runtime the MiniMax router uses for `speech-*` models, so synthesis never
 * goes through the OpenAI-compatible `/audio/speech` or the Anthropic-compatible runtime.
 */
export class LobeMinimaxSpeechAI implements LobeRuntimeAI {
  baseURL: string;
  private apiKey: string;
  private id: string;
  private modelIdMapping?: ModelIdMappingOptions['modelIdMapping'];

  constructor({
    apiKey,
    baseURL,
    id,
    modelIdMapping,
  }: ModelIdMappingOptions & { apiKey?: string; baseURL: string; id: string }) {
    if (!apiKey?.trim())
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.apiKey = apiKey.trim();
    this.baseURL = baseURL;
    this.id = id;
    this.modelIdMapping = modelIdMapping;
  }

  textToSpeech(payload: TextToSpeechPayload, options?: TextToSpeechOptions) {
    return createMiniMaxSpeech(payload, {
      ...options,
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      modelIdMapping: this.modelIdMapping,
      provider: this.id,
    });
  }
}
