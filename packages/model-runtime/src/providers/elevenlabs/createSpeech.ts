import { AgentRuntimeErrorType } from '@lobechat/types';
import createDebug from 'debug';
import type { TTSAudioFormat } from 'model-bank';
import { DEFAULT_TTS_AUDIO_FORMAT } from 'model-bank';

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

const log = createDebug('lobe-tts:elevenlabs');

export const DEFAULT_ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

export interface ElevenLabsSpeechOptions extends ModelIdMappingOptions, TextToSpeechOptions {
  apiKey: string;
  /** API host, e.g. `https://api.elevenlabs.io` or a data-residency host. */
  baseURL: string;
  /** Provider id used for pricing lookup and error payloads. */
  provider: string;
}

/**
 * `output_format` sent for each standard format. Formats with several sample rates take
 * `params.sampleRate` when it is one ElevenLabs offers; there is no `aac` or `flac` output.
 * @see https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
const ELEVENLABS_OUTPUT_FORMATS: Partial<
  Record<TTSAudioFormat, { default: string; sampleRates?: Record<number, string> }>
> = {
  mp3: {
    default: 'mp3_44100_128',
    sampleRates: { 22_050: 'mp3_22050_32', 24_000: 'mp3_24000_48' },
  },
  opus: { default: 'opus_48000_128' },
  pcm: {
    default: 'pcm_24000',
    sampleRates: {
      8000: 'pcm_8000',
      16_000: 'pcm_16000',
      22_050: 'pcm_22050',
      24_000: 'pcm_24000',
      44_100: 'pcm_44100',
      48_000: 'pcm_48000',
    },
  },
  wav: {
    default: 'wav_44100',
    sampleRates: {
      8000: 'wav_8000',
      16_000: 'wav_16000',
      22_050: 'wav_22050',
      24_000: 'wav_24000',
      44_100: 'wav_44100',
      48_000: 'wav_48000',
    },
  },
};

const HTTP_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  401: AgentRuntimeErrorType.InvalidProviderAPIKey,
  402: AgentRuntimeErrorType.InsufficientQuota,
  403: AgentRuntimeErrorType.PermissionDenied,
  429: AgentRuntimeErrorType.RateLimitExceeded,
};

/**
 * `detail.status` values that override the HTTP status mapping, e.g. an exhausted quota
 * comes back as a 401 but is not a bad key.
 * @see https://elevenlabs.io/docs/developers/resources/errors
 */
const DETAIL_STATUS_ERROR_TYPES: Record<string, ILobeAgentRuntimeErrorType> = {
  concurrent_limit_exceeded: AgentRuntimeErrorType.RateLimitExceeded,
  invalid_api_key: AgentRuntimeErrorType.InvalidProviderAPIKey,
  missing_permissions: AgentRuntimeErrorType.PermissionDenied,
  payment_required: AgentRuntimeErrorType.InsufficientQuota,
  quota_exceeded: AgentRuntimeErrorType.InsufficientQuota,
  rate_limit_exceeded: AgentRuntimeErrorType.RateLimitExceeded,
  system_busy: AgentRuntimeErrorType.RateLimitExceeded,
  too_many_concurrent_requests: AgentRuntimeErrorType.RateLimitExceeded,
};

/**
 * Free-tier keys cannot use Voice Library voices through the API, and the built-in voice
 * list (including the default) comes from the Voice Library.
 * @see https://elevenlabs.io/docs/eleven-creative/voices/voice-library
 */
export const ELEVENLABS_PAID_VOICE_HINT =
  'Free-tier ElevenLabs keys cannot use Voice Library voices (including the default Talia) through the API: upgrade the plan, or pass a voice you own with --voice.';

/** Thrown inside the request flow and unwrapped into a runtime error payload. */
class ElevenLabsSpeechError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Accepts the host with or without a trailing `/v1`, since users often paste either. */
export const normalizeElevenLabsBaseURL = (baseURL?: string | null) =>
  (baseURL?.trim() || DEFAULT_ELEVENLABS_BASE_URL).replace(/\/+$/, '').replace(/\/v1$/, '');

export const resolveElevenLabsOutputFormat = (
  format: TTSAudioFormat,
  sampleRate?: number,
): string => {
  const entry = ELEVENLABS_OUTPUT_FORMATS[format];

  if (!entry) {
    throw new ElevenLabsSpeechError(
      `ElevenLabs speech does not support the "${format}" format`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  return (sampleRate !== undefined && entry.sampleRates?.[sampleRate]) || entry.default;
};

/**
 * Map the standard TTS payload onto a Create speech request. `voice_settings` is only sent
 * when the caller set something, so the voice keeps its own saved settings otherwise.
 */
export const buildElevenLabsSpeechRequest = (
  payload: TextToSpeechPayload,
  requestModel: string,
): { body: Record<string, unknown>; format: TTSAudioFormat; outputFormat: string } => {
  if (!payload.voice?.trim()) {
    throw new ElevenLabsSpeechError(
      'ElevenLabs speech requires a voice id',
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  const params = resolveTextToSpeechParams(payload);
  const format = params.format ?? DEFAULT_TTS_AUDIO_FORMAT;
  const outputFormat = resolveElevenLabsOutputFormat(format, params.sampleRate);

  return {
    body: {
      model_id: requestModel,
      text: payload.input,
      ...(params.speed !== undefined && { voice_settings: { speed: params.speed } }),
    },
    format,
    outputFormat,
  };
};

interface ElevenLabsErrorDetail {
  code?: string;
  message?: string;
  status?: string;
}

interface ElevenLabsErrorBody {
  detail?: ElevenLabsErrorDetail | { loc?: unknown[]; msg?: string; type?: string }[] | string;
}

const readErrorBody = async (response: Response): Promise<ElevenLabsErrorBody | undefined> => {
  const text = await response.text().catch(() => '');
  if (!text) return;

  try {
    return JSON.parse(text) as ElevenLabsErrorBody;
  } catch {
    return { detail: text };
  }
};

/** Readable message and `detail.status` from the error shapes ElevenLabs returns. */
const parseErrorDetail = (body?: ElevenLabsErrorBody): { message?: string; status?: string } => {
  const detail = body?.detail;
  if (!detail) return {};
  if (typeof detail === 'string') return { message: detail };

  // 422 validation errors are FastAPI-style `[{ loc, msg, type }]`
  if (Array.isArray(detail)) {
    const message = detail
      .map((item) => {
        const loc = Array.isArray(item.loc) ? item.loc.join('.') : undefined;
        return loc ? `${loc}: ${item.msg}` : item.msg;
      })
      .filter(Boolean)
      .join('; ');

    return { message: message || undefined };
  }

  return { message: detail.message, status: detail.status ?? detail.code };
};

/** Billed characters reported by ElevenLabs, if the header is present and numeric. */
const readCharacterCount = (response: Response): number | undefined => {
  const raw = response.headers.get('x-character-count');
  if (raw === null || raw.trim() === '') return;

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

/**
 * Synthesize speech with ElevenLabs' `POST /v1/text-to-speech/{voice_id}`, which returns
 * the audio bytes directly. Usage is the billed `x-character-count` header, falling back
 * to a local character count.
 * @see https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
export async function createElevenLabsSpeech(
  payload: TextToSpeechPayload,
  options: ElevenLabsSpeechOptions,
): Promise<TextToSpeechResponse> {
  const { apiKey, provider } = options;
  const baseURL = normalizeElevenLabsBaseURL(options.baseURL);
  const requestModel = resolveMappedModelId(payload.model, options);

  let result: TextToSpeechResponse;
  try {
    const { body, format, outputFormat } = buildElevenLabsSpeechRequest(payload, requestModel);
    const pricing = await getModelPricing(payload.model, provider, options.pricingContext);

    const url = new URL(`${baseURL}/v1/text-to-speech/${encodeURIComponent(payload.voice)}`);
    url.searchParams.set('output_format', outputFormat);

    log(
      'text-to-speech request: model=%s voice=%s output_format=%s',
      requestModel,
      payload.voice,
      outputFormat,
    );

    const response = await fetch(url.toString(), {
      body: JSON.stringify(body),
      headers: {
        ...options.headers,
        'Accept': 'audio/*',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      method: 'POST',
      signal: options.signal,
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      const { message, status } = parseErrorDetail(errorBody);
      const paymentRequired = response.status === 402 || status === 'payment_required';
      const reason = message || response.statusText || 'request failed';

      throw new ElevenLabsSpeechError(
        paymentRequired
          ? `ElevenLabs API error (${response.status}): ${reason.replace(/\.+$/, '')}. ${ELEVENLABS_PAID_VOICE_HINT}`
          : `ElevenLabs API error (${response.status}): ${reason}`,
        (status ? DETAIL_STATUS_ERROR_TYPES[status] : undefined) ??
          HTTP_ERROR_TYPES[response.status] ??
          AgentRuntimeErrorType.ProviderBizError,
        { detail: errorBody?.detail, status: response.status },
      );
    }

    const audio = await response.arrayBuffer();

    if (audio.byteLength === 0) {
      throw new ElevenLabsSpeechError(
        'ElevenLabs returned empty audio',
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    const characterCount = readCharacterCount(response);

    log(
      'text-to-speech done: %d bytes, x-character-count=%s, request-id=%s',
      audio.byteLength,
      characterCount,
      response.headers.get('request-id'),
    );

    const usage = convertTextToSpeechUsage(
      payload.input,
      pricing,
      characterCount === undefined ? undefined : { inputCharacters: characterCount },
    );

    result = { audio, format, usage };
  } catch (error) {
    log('createElevenLabsSpeech error: %O', error);

    if ((error as Error)?.name === 'AbortError') throw error;

    const errorType =
      error instanceof ElevenLabsSpeechError
        ? error.errorType
        : AgentRuntimeErrorType.ProviderBizError;

    throw AgentRuntimeError.chat({
      error: {
        message: (error as Error)?.message ?? String(error),
        ...(error instanceof ElevenLabsSpeechError ? error.detail : undefined),
      },
      errorType,
      provider,
    } satisfies ChatCompletionErrorPayload);
  }

  await options.onUsage?.(result.usage!);

  return result;
}
