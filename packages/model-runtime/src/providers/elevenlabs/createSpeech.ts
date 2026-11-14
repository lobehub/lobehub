import { AgentRuntimeErrorType } from '@lobechat/types';
import createDebug from 'debug';
import type { TTSAudioFormat } from 'model-bank';
import {
  DEFAULT_TTS_AUDIO_FORMAT,
  ELEVENLABS_DEFAULT_VOICE_ID,
  ELEVENLABS_VOICE_IDS,
} from 'model-bank';

import {
  convertTextToSpeechUsage,
  countTextToSpeechCharacters,
} from '../../core/usageConverters/tts';
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

/**
 * Characters per request. The audio comes back in one inline response, and a longer
 * request would exceed the serverless response limit only after the synthesis was billed.
 * Enforced here as well as in the TTS service, so routed aliases are capped too.
 */
export const ELEVENLABS_MAX_INPUT_CHARACTERS = 4096;

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
  insufficient_credits: AgentRuntimeErrorType.InsufficientQuota,
  invalid_api_key: AgentRuntimeErrorType.InvalidProviderAPIKey,
  missing_permissions: AgentRuntimeErrorType.PermissionDenied,
  payment_required: AgentRuntimeErrorType.InsufficientQuota,
  quota_exceeded: AgentRuntimeErrorType.InsufficientQuota,
  rate_limit_exceeded: AgentRuntimeErrorType.RateLimitExceeded,
  system_busy: AgentRuntimeErrorType.RateLimitExceeded,
  too_many_concurrent_requests: AgentRuntimeErrorType.RateLimitExceeded,
};

/**
 * Free-tier keys cannot use Voice Library voices through the API, and every built-in
 * voice except the default (Roger) comes from the Voice Library.
 * @see https://elevenlabs.io/docs/eleven-creative/voices/voice-library
 */
export const ELEVENLABS_NO_ACCOUNT_VOICE_HINT =
  'The default voice is not available to this ElevenLabs account and no usable voice was found in it (the key needs the voices_read permission to look one up): pass a voice you own with --voice.';

export const ELEVENLABS_PAID_VOICE_HINT =
  'Free-tier ElevenLabs keys cannot use Voice Library voices (such as Talia) through the API: upgrade the plan, or pass the default voice or a voice you own with --voice.';

/** Thrown inside the request flow and unwrapped into a runtime error payload. */
class ElevenLabsSpeechError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType,
    readonly detail?: Record<string, unknown>,
    /** The request failed because of the voice, so another voice might succeed. */
    readonly voiceUnavailable = false,
  ) {
    super(message);
  }
}

/** Strip trailing `char`s with a linear scan (a `/x+$/` regex backtracks quadratically). */
const trimTrailing = (value: string, char: string) => {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end--;
  return value.slice(0, end);
};

/** Accepts the host with or without a trailing `/v1`, since users often paste either. */
export const normalizeElevenLabsBaseURL = (baseURL?: string | null) => {
  const url = trimTrailing(baseURL?.trim() || DEFAULT_ELEVENLABS_BASE_URL, '/');
  return url.endsWith('/v1') ? url.slice(0, -3) : url;
};

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
const parseErrorDetail = (
  body?: ElevenLabsErrorBody,
): { codes: string[]; message?: string; status?: string } => {
  const detail = body?.detail;
  if (!detail) return { codes: [] };
  if (typeof detail === 'string') return { codes: [], message: detail };

  // 422 validation errors are FastAPI-style `[{ loc, msg, type }]`
  if (Array.isArray(detail)) {
    const message = detail
      .map((item) => {
        const loc = Array.isArray(item.loc) ? item.loc.join('.') : undefined;
        return loc ? `${loc}: ${item.msg}` : item.msg;
      })
      .filter(Boolean)
      .join('; ');

    return { codes: [], message: message || undefined };
  }

  return {
    codes: [detail.status, detail.code].filter((value): value is string => !!value),
    message: detail.message,
    status: detail.status ?? detail.code,
  };
};

/** Turn a failed Create speech response into a typed error with a readable message. */
/** Codes ElevenLabs uses when the account may not use the requested voice. */
const VOICE_UNAVAILABLE_CODES = new Set([
  'paid_plan_required',
  'payment_required',
  'voice_does_not_exist',
  'voice_not_found',
]);

/** Account-level billing failures: no other voice would help. */
const QUOTA_CODES = new Set(['insufficient_credits', 'quota_exceeded']);

/**
 * Whether a failed request was about the voice rather than the account: 404 or a
 * voice/plan code, or a 402 whose message names the voice (free keys calling Voice Library
 * voices). Credit and quota exhaustion are never voice failures.
 * @see https://elevenlabs.io/docs/eleven-api/resources/errors
 */
const classifyVoiceError = (httpStatus: number, codes: string[], message?: string) => {
  if (codes.some((code) => QUOTA_CODES.has(code))) return { paidVoice: false, unavailable: false };

  const paidVoice =
    codes.some((code) => code === 'payment_required' || code === 'paid_plan_required') ||
    (httpStatus === 402 && /voice/i.test(message ?? ''));

  return {
    paidVoice,
    unavailable:
      paidVoice || httpStatus === 404 || codes.some((code) => VOICE_UNAVAILABLE_CODES.has(code)),
  };
};

/** Turn a failed Create speech response into a typed error with a readable message. */
const toSpeechError = async (response: Response): Promise<ElevenLabsSpeechError> => {
  const errorBody = await readErrorBody(response);
  const { codes, message } = parseErrorDetail(errorBody);
  const { paidVoice, unavailable } = classifyVoiceError(response.status, codes, message);
  const reason = message || response.statusText || 'request failed';

  return new ElevenLabsSpeechError(
    paidVoice
      ? `ElevenLabs API error (${response.status}): ${trimTrailing(reason, '.')}. ${ELEVENLABS_PAID_VOICE_HINT}`
      : `ElevenLabs API error (${response.status}): ${reason}`,
    codes.map((code) => DETAIL_STATUS_ERROR_TYPES[code]).find(Boolean) ??
      HTTP_ERROR_TYPES[response.status] ??
      AgentRuntimeErrorType.ProviderBizError,
    { detail: errorBody?.detail, status: response.status },
    unavailable,
  );
};

const isVoiceUnavailable = (error: ElevenLabsSpeechError) => error.voiceUnavailable;

/**
 * Queries for a voice the account can always call, best first: voices it created
 * (`voice_type=personal`: instant and professional clones and designed voices), then the
 * premade ones it still has. Voice Library voices saved to the account are also
 * `professional` but not owned, and need a paid plan on the API, so they are skipped.
 * @see https://elevenlabs.io/docs/api-reference/voices/search
 */
const ACCOUNT_VOICE_QUERIES: Record<string, string>[] = [
  { voice_type: 'personal' },
  { category: 'premade' },
];

/**
 * First voice in the account that it can call, from the paginated `GET /v2/voices` (the
 * legacy `GET /v1/voices` stops working past 500 voices). Two results per query are enough
 * to skip the rejected default. Returns undefined when the key lacks `voices_read` or the
 * account has no such voice.
 */
export const resolveAccountVoice = async (
  baseURL: string,
  apiKey: string,
  options: Pick<ElevenLabsSpeechOptions, 'headers' | 'signal'>,
): Promise<string | undefined> => {
  for (const query of ACCOUNT_VOICE_QUERIES) {
    try {
      const url = new URL(`${baseURL}/v2/voices`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      url.searchParams.set('page_size', '2');

      const response = await fetch(url.toString(), {
        headers: { ...options.headers, 'xi-api-key': apiKey },
        signal: options.signal,
      });
      if (!response.ok) {
        log('list voices %o failed: %d', query, response.status);
        // A missing permission or bad key fails every query the same way.
        return;
      }

      const { voices = [] } = (await response.json()) as {
        voices?: { is_owner?: boolean; voice_id?: string }[];
      };
      const voice = voices.find(
        (item) =>
          item.voice_id &&
          item.voice_id !== ELEVENLABS_DEFAULT_VOICE_ID &&
          // Owned voices only from the personal query; premade voices report no owner.
          (query.voice_type !== 'personal' || item.is_owner !== false),
      );
      if (voice?.voice_id) return voice.voice_id;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      log('list voices %o error: %O', query, error);
      return;
    }
  }
};

/** How long an account fallback voice is reused before it is looked up again. */
export const FALLBACK_VOICE_TTL_MS = 60 * 60 * 1000;
const FALLBACK_VOICE_CACHE_LIMIT = 500;

/**
 * Account fallback voice per host + key (stored by SHA-256, never the key itself), so an
 * account that cannot use the default skips the rejected request and the voice lookup.
 * Per process: each serverless instance warms its own entry.
 */
const fallbackVoices = new Map<string, { expiresAt: number; voice: string }>();

const fallbackCacheKey = async (baseURL: string, apiKey: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${baseURL}\n${apiKey}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readFallbackVoice = (key: string) => {
  const entry = fallbackVoices.get(key);
  if (!entry) return;
  if (entry.expiresAt <= Date.now()) {
    fallbackVoices.delete(key);
    return;
  }
  return entry.voice;
};

const writeFallbackVoice = (key: string, voice: string) => {
  fallbackVoices.delete(key);
  if (fallbackVoices.size >= FALLBACK_VOICE_CACHE_LIMIT) {
    // Maps iterate in insertion order: drop the oldest entry.
    fallbackVoices.delete(fallbackVoices.keys().next().value!);
  }
  fallbackVoices.set(key, { expiresAt: Date.now() + FALLBACK_VOICE_TTL_MS, voice });
};

/** Test helper: forget every cached fallback voice. */
export const clearElevenLabsFallbackVoices = () => fallbackVoices.clear();

/**
 * Synthesize speech with ElevenLabs' `POST /v1/text-to-speech/{voice_id}`, which returns
 * the audio bytes directly. Usage is the input character count, which is what the
 * per-character API price applies to. The `character-cost` response header is logged but
 * not used: it reports plan credits (e.g. 7 for a 34-character Flash request, 14 on
 * Multilingual v2), not characters.
 * @see https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
export async function createElevenLabsSpeech(
  request: TextToSpeechPayload,
  options: ElevenLabsSpeechOptions,
): Promise<TextToSpeechResponse> {
  const { apiKey, provider } = options;
  const baseURL = normalizeElevenLabsBaseURL(options.baseURL);

  // A caller-omitted voice may have been filled from another vendor's default (e.g. a routed
  // alias without a static card gets `alloy`); use the ElevenLabs default instead.
  const payload: TextToSpeechPayload =
    request.voiceIsDefault && !ELEVENLABS_VOICE_IDS.has(request.voice)
      ? { ...request, voice: ELEVENLABS_DEFAULT_VOICE_ID }
      : request;
  const requestModel = resolveMappedModelId(payload.model, options);

  let result: TextToSpeechResponse;
  try {
    const inputCharacters = countTextToSpeechCharacters(payload.input);
    if (inputCharacters > ELEVENLABS_MAX_INPUT_CHARACTERS) {
      throw new ElevenLabsSpeechError(
        `ElevenLabs speech input is ${inputCharacters} characters; the limit is ${ELEVENLABS_MAX_INPUT_CHARACTERS} per request. Split the text into shorter requests.`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    const { body, format, outputFormat } = buildElevenLabsSpeechRequest(payload, requestModel);
    const pricing = await getModelPricing(payload.model, provider, options.pricingContext);

    const send = (voice: string) => {
      const url = new URL(`${baseURL}/v1/text-to-speech/${encodeURIComponent(voice)}`);
      url.searchParams.set('output_format', outputFormat);

      log(
        'text-to-speech request: model=%s voice=%s output_format=%s',
        requestModel,
        voice,
        outputFormat,
      );

      return fetch(url.toString(), {
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
    };

    // Only a voice the service filled in from the card may be swapped; a caller that asked
    // for the default voice by id gets that voice or its error.
    const fallbackKey =
      payload.voiceIsDefault && payload.voice === ELEVENLABS_DEFAULT_VOICE_ID
        ? await fallbackCacheKey(baseURL, apiKey)
        : undefined;
    const cachedVoice = fallbackKey ? readFallbackVoice(fallbackKey) : undefined;

    let response = await send(cachedVoice ?? payload.voice);

    // A cached fallback voice that stops working (deleted, plan change) is dropped, and
    // the request starts over from the default voice.
    if (!response.ok && cachedVoice) {
      const error = await toSpeechError(response);
      // Transient failures (429, 5xx) keep the entry: the cached voice is still valid.
      if (!isVoiceUnavailable(error)) throw error;
      fallbackVoices.delete(fallbackKey!);
      response = await send(payload.voice);
    }

    if (!response.ok) {
      const error = await toSpeechError(response);

      // The built-in default voice is not callable on every account (free tier, or
      // accounts created after the Default voices were withdrawn): retry once with a
      // voice the account can use, and remember it. A rejected request is not billed.
      if (!fallbackKey || !isVoiceUnavailable(error)) throw error;

      const fallback = await resolveAccountVoice(baseURL, apiKey, options);
      if (!fallback) {
        throw new ElevenLabsSpeechError(
          `${trimTrailing(error.message, '.')}. ${ELEVENLABS_NO_ACCOUNT_VOICE_HINT}`,
          error.errorType,
          error.detail,
        );
      }

      log('default voice unavailable, retrying with account voice %s', fallback);
      response = await send(fallback);
      if (!response.ok) throw await toSpeechError(response);
      writeFallbackVoice(fallbackKey, fallback);
    }

    const audio = await response.arrayBuffer();

    if (audio.byteLength === 0) {
      throw new ElevenLabsSpeechError(
        'ElevenLabs returned empty audio',
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    log(
      'text-to-speech done: %d bytes, character-cost=%s, request-id=%s',
      audio.byteLength,
      response.headers.get('character-cost'),
      response.headers.get('request-id'),
    );

    const usage = convertTextToSpeechUsage(payload.input, pricing);

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
