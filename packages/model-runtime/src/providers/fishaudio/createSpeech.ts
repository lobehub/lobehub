import { AgentRuntimeErrorType } from '@lobechat/types';
import createDebug from 'debug';
import type { TTSAudioFormat } from 'model-bank';
import {
  DEFAULT_TTS_AUDIO_FORMAT,
  FISH_AUDIO_DEFAULT_VOICE_ID,
  FISH_AUDIO_MAX_INSTRUCTIONS_LENGTH,
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

const log = createDebug('lobe-tts:fishaudio');

export const DEFAULT_FISH_AUDIO_BASE_URL = 'https://api.fish.audio';

/**
 * Characters per request. The audio comes back in one inline response, so a longer request
 * would exceed the serverless response limit only after the synthesis was billed. Enforced
 * here as well as in the TTS service, so routed aliases are capped too.
 */
export const FISH_AUDIO_MAX_INPUT_CHARACTERS = 4096;

/**
 * Values of the `model` header. Fish Audio does not reject an unknown value: it silently
 * synthesizes (and bills) with S2.1 Pro, so anything else is refused before the request.
 * @see https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 */
export const FISH_AUDIO_MODELS: ReadonlySet<string> = new Set([
  's1',
  's2-pro',
  's2.1-pro',
  's2.1-pro-free',
  'drama-3',
]);

/** Voice model ids are 32 hex characters, as in `fish.audio/m/<id>`. */
const FISH_AUDIO_REFERENCE_ID = /^[\da-f]{32}$/i;

/** Models that read a leading `[direction]`; S1 would speak it aloud. */
const DIRECTED_MODELS = new Set(['s2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3']);

/** Formats `/v1/tts` produces; there is no aac or flac output. */
const FISH_AUDIO_FORMATS = new Set<TTSAudioFormat>(['mp3', 'opus', 'pcm', 'wav']);

export interface FishAudioSpeechOptions extends ModelIdMappingOptions, TextToSpeechOptions {
  apiKey: string;
  /** API host, e.g. `https://api.fish.audio`. */
  baseURL: string;
  /** Provider id used for pricing lookup and error payloads. */
  provider: string;
}

const HTTP_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  401: AgentRuntimeErrorType.InvalidProviderAPIKey,
  402: AgentRuntimeErrorType.InsufficientQuota,
  403: AgentRuntimeErrorType.PermissionDenied,
  429: AgentRuntimeErrorType.RateLimitExceeded,
};

/**
 * Appended when Fish Audio rejects the voice: a `reference_id` that does not exist or that
 * the account may not use.
 */
export const FISH_AUDIO_VOICE_HINT =
  'Check the voice id: pass the reference_id of a voice you own or are licensed to use with --voice, or omit --voice for the Fish Audio default voice.';

/** Thrown inside the request flow and unwrapped into a runtime error payload. */
class FishAudioSpeechError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType,
    readonly detail?: Record<string, unknown>,
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
export const normalizeFishAudioBaseURL = (baseURL?: string | null) => {
  const url = trimTrailing(baseURL?.trim() || DEFAULT_FISH_AUDIO_BASE_URL, '/');
  return url.endsWith('/v1') ? url.slice(0, -3) : url;
};

/**
 * Fish Audio bills per million UTF-8 bytes, so a Han character costs three times a Latin
 * letter. Reported as `inputCharacters` against the per-byte price on the model card.
 * @see https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits
 */
export const countFishAudioBilledBytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * Text sent to Fish Audio: the S2 family and Drama 3 take a natural-language `[direction]`
 * written into the text, so `instructions` goes in front of the input.
 */
export const buildFishAudioText = (input: string, model: string, instructions?: string) => {
  const direction = instructions?.trim();
  if (!direction) return input;

  if (!DIRECTED_MODELS.has(model)) {
    throw new FishAudioSpeechError(
      `Fish Audio ${model} does not take instructions`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }
  if (direction.length > FISH_AUDIO_MAX_INSTRUCTIONS_LENGTH) {
    throw new FishAudioSpeechError(
      `Fish Audio instructions are limited to ${FISH_AUDIO_MAX_INSTRUCTIONS_LENGTH} characters`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  // A bracket inside the direction would close it early and speak the rest.
  const sanitized = direction.replaceAll(/[[\]]/g, ' ').replaceAll(/\s+/g, ' ').trim();
  return `[${sanitized}] ${input}`;
};

/**
 * Map the standard TTS payload onto a `/v1/tts` request. The built-in default voice sends
 * no `reference_id`, which makes Fish Audio use its own default voice.
 */
export const buildFishAudioSpeechRequest = (
  payload: TextToSpeechPayload,
  requestModel: string,
): { body: Record<string, unknown>; format: TTSAudioFormat; text: string } => {
  if (!FISH_AUDIO_MODELS.has(requestModel)) {
    throw new FishAudioSpeechError(
      `Unknown Fish Audio model "${requestModel}"; expected one of ${[...FISH_AUDIO_MODELS].join(', ')}`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  const params = resolveTextToSpeechParams(payload);
  const format = params.format ?? DEFAULT_TTS_AUDIO_FORMAT;
  if (!FISH_AUDIO_FORMATS.has(format)) {
    throw new FishAudioSpeechError(
      `Fish Audio speech does not support the "${format}" format`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  const voice = payload.voice?.trim();
  const text = buildFishAudioText(payload.input, requestModel, params.instructions);

  return {
    body: {
      format,
      text,
      ...(voice && voice !== FISH_AUDIO_DEFAULT_VOICE_ID && { reference_id: voice }),
      ...(params.sampleRate !== undefined && { sample_rate: params.sampleRate }),
      ...(params.speed !== undefined && { prosody: { speed: params.speed } }),
    },
    format,
    text,
  };
};

interface FishAudioErrorBody {
  detail?: unknown;
  message?: string;
  reason?: string;
  status?: number;
}

const readErrorBody = async (response: Response): Promise<FishAudioErrorBody | undefined> => {
  const text = await response.text().catch(() => '');
  if (!text) return;

  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? (body as FishAudioErrorBody) : { message: text };
  } catch {
    // Edge proxies answer 413 / 5xx in plain text.
    return { message: text.slice(0, 500) };
  }
};

const readableMessage = (body?: FishAudioErrorBody): string | undefined => {
  if (!body) return;
  if (typeof body.message === 'string' && body.message) return body.message;
  if (typeof body.detail === 'string' && body.detail) return body.detail;
  if (Array.isArray(body.detail)) {
    // FastAPI-style validation errors `[{ loc, msg }]`.
    const message = body.detail
      .map((item) => (item && typeof item === 'object' ? (item as { msg?: string }).msg : ''))
      .filter(Boolean)
      .join('; ');
    return message || undefined;
  }
  if (typeof body.reason === 'string' && body.reason) return body.reason;
};

/** Turn a failed `/v1/tts` response into a typed error with a readable message. */
const toSpeechError = async (
  response: Response,
  sentReferenceId: boolean,
): Promise<FishAudioSpeechError> => {
  const body = await readErrorBody(response);
  const reason = readableMessage(body) || response.statusText || 'request failed';
  // 400 covers a missing reference_id as well as bad parameters; 404 a missing voice or model.
  const voiceRejected =
    sentReferenceId &&
    (response.status === 404 || (response.status === 400 && /reference|voice|model/i.test(reason)));

  return new FishAudioSpeechError(
    voiceRejected
      ? `Fish Audio API error (${response.status}): ${trimTrailing(reason, '.')}. ${FISH_AUDIO_VOICE_HINT}`
      : `Fish Audio API error (${response.status}): ${reason}`,
    HTTP_ERROR_TYPES[response.status] ?? AgentRuntimeErrorType.ProviderBizError,
    { detail: body, status: response.status },
  );
};

/**
 * Synthesize speech with Fish Audio's `POST /v1/tts`, which returns the audio bytes
 * directly. Usage is the UTF-8 byte count of the text sent (including a direction), which
 * is what the per-byte API price applies to.
 * @see https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 */
export async function createFishAudioSpeech(
  request: TextToSpeechPayload,
  options: FishAudioSpeechOptions,
): Promise<TextToSpeechResponse> {
  const { apiKey, provider } = options;
  const baseURL = normalizeFishAudioBaseURL(options.baseURL);

  // A caller-omitted voice may have been filled from another vendor's default (e.g. a routed
  // alias without a static card gets `alloy`); use the Fish Audio default voice instead.
  const payload: TextToSpeechPayload =
    request.voiceIsDefault && !FISH_AUDIO_REFERENCE_ID.test(request.voice)
      ? { ...request, voice: FISH_AUDIO_DEFAULT_VOICE_ID }
      : request;
  const requestModel = resolveMappedModelId(payload.model, options);

  let result: TextToSpeechResponse;
  try {
    const inputCharacters = countTextToSpeechCharacters(payload.input);
    if (inputCharacters > FISH_AUDIO_MAX_INPUT_CHARACTERS) {
      throw new FishAudioSpeechError(
        `Fish Audio speech input is ${inputCharacters} characters; the limit is ${FISH_AUDIO_MAX_INPUT_CHARACTERS} per request. Split the text into shorter requests.`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }
    if (!payload.input.trim()) {
      throw new FishAudioSpeechError(
        'Fish Audio speech input is empty',
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    const { body, format, text } = buildFishAudioSpeechRequest(payload, requestModel);
    const pricing = await getModelPricing(payload.model, provider, options.pricingContext);

    log(
      'tts request: model=%s reference_id=%s format=%s',
      requestModel,
      body.reference_id ?? '(default)',
      format,
    );

    const response = await fetch(`${baseURL}/v1/tts`, {
      body: JSON.stringify(body),
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Always sent: a missing header silently falls back to S2.1 Pro.
        'model': requestModel,
      },
      method: 'POST',
      signal: options.signal,
    });

    if (!response.ok) throw await toSpeechError(response, 'reference_id' in body);

    // A 200 carries raw audio; a JSON body would be an error the gateway passed through.
    if (response.headers.get('content-type')?.includes('application/json')) {
      const errorBody = await readErrorBody(response);
      throw new FishAudioSpeechError(
        `Fish Audio returned no audio: ${readableMessage(errorBody) ?? 'unexpected JSON response'}`,
        AgentRuntimeErrorType.ProviderBizError,
        { detail: errorBody },
      );
    }

    const audio = await response.arrayBuffer();

    if (audio.byteLength === 0) {
      throw new FishAudioSpeechError(
        'Fish Audio returned empty audio',
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    log('tts done: %d bytes', audio.byteLength);

    const usage = convertTextToSpeechUsage(text, pricing, {
      inputCharacters: countFishAudioBilledBytes(text),
    });

    result = { audio, format, usage };
  } catch (error) {
    log('createFishAudioSpeech error: %O', error);

    if ((error as Error)?.name === 'AbortError') throw error;

    const errorType =
      error instanceof FishAudioSpeechError
        ? error.errorType
        : AgentRuntimeErrorType.ProviderBizError;

    throw AgentRuntimeError.chat({
      error: {
        message: (error as Error)?.message ?? String(error),
        ...(error instanceof FishAudioSpeechError ? error.detail : undefined),
      },
      errorType,
      provider,
    } satisfies ChatCompletionErrorPayload);
  }

  await options.onUsage?.(result.usage!);

  return result;
}
