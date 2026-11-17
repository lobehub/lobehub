import { AgentRuntimeErrorType } from '@lobechat/types';
import createDebug from 'debug';
import type { TTSAudioFormat } from 'model-bank';
import { DEFAULT_TTS_AUDIO_FORMAT } from 'model-bank';

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

const log = createDebug('lobe-tts:gmicloudspeech');

export const DEFAULT_GMICLOUD_BASE_URL = 'https://console.gmicloud.ai';

/** GMI Cloud's multimodal request queue; the same queue serves speech and video. */
export const GMICLOUD_QUEUE_PATH = '/api/v1/ie/requestqueue/apikey/requests';

/**
 * Characters per request. The queue returns one audio file per generation and the audio
 * comes back inside one inline response, matching the other inline speech providers.
 */
export const GMICLOUD_MAX_INPUT_CHARACTERS = 4096;

/** Polling budget for queued generations: 90 attempts x 2s. MiniMax generations go
 * through GMI Cloud's queue and are usually quick, but an occasional request runs long. */
export const GMICLOUD_POLL_ATTEMPTS = 90;
export const GMICLOUD_POLL_INTERVAL_MS = 2000;

/** Poll statuses worth retrying; anything else is a permanent failure. */
const TRANSIENT_POLL_STATUSES = new Set([408, 429]);

const HTTP_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  401: AgentRuntimeErrorType.InvalidProviderAPIKey,
  402: AgentRuntimeErrorType.InsufficientQuota,
  403: AgentRuntimeErrorType.PermissionDenied,
  429: AgentRuntimeErrorType.RateLimitExceeded,
};

/** Thrown inside the request flow and unwrapped into a runtime error payload. */
class GmicloudSpeechError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Accepts the host with or without a trailing slash. */
export const normalizeGmicloudBaseURL = (baseURL?: string | null) => {
  const url = (baseURL?.trim() || DEFAULT_GMICLOUD_BASE_URL).replace(/\/+$/, '');
  return url;
};

type GmicloudSpeechFamily = 'inworld' | 'minimax' | 'chatterbox';

/** Request family from the model id; unknown ids use the Inworld shape. */
export const modelFamily = (model: string): GmicloudSpeechFamily => {
  const id = (model || '').toLowerCase();
  if (id.startsWith('minimax')) return 'minimax';
  if (id.startsWith('chatterbox')) return 'chatterbox';
  return 'inworld';
};

/** Documented default voice per family; also used when the caller accepted a default. */
const FAMILY_DEFAULT_VOICES: Record<GmicloudSpeechFamily, string | undefined> = {
  chatterbox: undefined,
  inworld: 'Dennis',
  minimax: 'English_expressive_narrator',
};

/**
 * Only `mp3` and `wav` are supported: GMI Cloud returns WAV or MP3 per family
 * (`audio_encoding` for Inworld, `format` for MiniMax and Chatterbox).
 */
export const resolveGmicloudOutputFormat = (format: TTSAudioFormat): TTSAudioFormat => {
  if (format !== 'mp3' && format !== 'wav') {
    throw new GmicloudSpeechError(
      `GMI Cloud speech does not support the "${format}" format`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }
  return format;
};

/**
 * Map the standard TTS payload onto GMI Cloud's request shape. The request body is
 * `{ model, payload }` against the request queue, with the payload keyed by family.
 */
export const buildGmicloudSpeechRequest = (
  payload: TextToSpeechPayload,
  requestModel: string,
): { body: Record<string, unknown>; format: TTSAudioFormat } => {
  const params = resolveTextToSpeechParams(payload);
  const format = resolveGmicloudOutputFormat(params.format ?? DEFAULT_TTS_AUDIO_FORMAT);
  const speed = params.speed ?? 1;
  const family = modelFamily(requestModel);

  // A caller-omitted voice may have been filled from another provider's default; use the
  // family default instead. An explicit voice is never replaced.
  const familyDefault = FAMILY_DEFAULT_VOICES[family];
  const voice =
    payload.voiceIsDefault && familyDefault && payload.voice !== familyDefault
      ? familyDefault
      : payload.voice;

  let request: Record<string, unknown>;
  if (family === 'inworld') {
    request = {
      text: payload.input,
      audio_encoding: format.toUpperCase(),
      speaking_rate: speed,
      ...(voice && { voice_id: voice }),
    };
  } else if (family === 'minimax') {
    request = {
      text: payload.input,
      speed: String(speed),
      format,
      ...(voice && { voice_id: voice }),
    };
  } else {
    // chatterbox
    if (!voice?.trim()) {
      throw new GmicloudSpeechError(
        'Chatterbox models require a Resemble voice UUID: pass your voice_uuid as the voice.',
        AgentRuntimeErrorType.ProviderBizError,
      );
    }
    request = {
      data: payload.input,
      voice_uuid: voice,
      output_format: format,
    };
  }

  return { body: { model: requestModel, payload: request }, format };
};

/** Extract the first audio URL from a queue response outcome. */
export const extractGmicloudAudioUrl = (data: Record<string, any>): string | undefined => {
  const outcome = data?.outcome;
  if (!outcome || typeof outcome !== 'object') return undefined;
  if (typeof outcome.audio_url === 'string' && outcome.audio_url) return outcome.audio_url;
  for (const key of ['media_urls', 'medias', 'media']) {
    for (const item of outcome[key] ?? []) {
      if (item && typeof item.url === 'string' && item.url) return item.url;
    }
  }
  return undefined;
};

const readErrorBody = async (response: Response): Promise<string | undefined> => {
  const text = await response.text().catch(() => '');
  return text || undefined;
};

/** Turn a failed request into a typed error with a readable message. */
const toSpeechError = async (response: Response): Promise<GmicloudSpeechError> => {
  const bodyText = await readErrorBody(response);
  let message = response.statusText || 'request failed';
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      message = parsed?.error ?? parsed?.message ?? bodyText;
    } catch {
      message = bodyText;
    }
  }

  return new GmicloudSpeechError(
    `GMI Cloud API error (${response.status}): ${message}`,
    HTTP_ERROR_TYPES[response.status] ?? AgentRuntimeErrorType.ProviderBizError,
    { status: response.status },
  );
};

interface GmicloudSpeechOptions extends ModelIdMappingOptions, TextToSpeechOptions {
  apiKey: string;
  /** API host, e.g. `https://console.gmicloud.ai`. */
  baseURL: string;
  /** Provider id used for pricing lookup and error payloads. */
  provider: string;
}

/**
 * Resolve a response that may be synchronous or queued. The queue response carries a
 * `request_id` and is polled until it reports `success` or `failed`; permanent HTTP
 * errors while polling raise immediately, 408/429/5xx keep polling.
 */
const resolveGmicloudResult = async (
  data: Record<string, any>,
  options: GmicloudSpeechOptions,
): Promise<{ data: Record<string, any>; audioUrl?: string }> => {
  let status = data?.status;
  const requestId = data?.request_id;
  let audioUrl = extractGmicloudAudioUrl(data);

  if (!audioUrl && status !== 'failed' && requestId) {
    const url = `${normalizeGmicloudBaseURL(options.baseURL)}${GMICLOUD_QUEUE_PATH}/${requestId}`;

    for (let attempt = 0; attempt < GMICLOUD_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, GMICLOUD_POLL_INTERVAL_MS));
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
        signal: options.signal,
      });

      if (response.status === 200) {
        data = await response.json();
      } else if (TRANSIENT_POLL_STATUSES.has(response.status) || response.status >= 500) {
        continue; // transient: keep polling
      } else {
        throw await toSpeechError(response);
      }

      status = data?.status;
      audioUrl = extractGmicloudAudioUrl(data);
      if (status === 'success' || status === 'failed' || audioUrl) break;
    }
  }

  return { audioUrl, data };
};

/**
 * Run one generation to completion against GMI Cloud's request queue and return the
 * audio. Inworld generations are usually synchronous; MiniMax generations go through
 * the queue and are polled. Only WAV and MP3 output are supported.
 */
export async function createGmicloudSpeech(
  request: TextToSpeechPayload,
  options: GmicloudSpeechOptions,
): Promise<TextToSpeechResponse> {
  const { apiKey, provider } = options;

  let result: TextToSpeechResponse;
  try {
    const inputCharacters = countTextToSpeechCharacters(request.input);
    if (inputCharacters > GMICLOUD_MAX_INPUT_CHARACTERS) {
      throw new GmicloudSpeechError(
        `GMI Cloud speech input is ${inputCharacters} characters; the limit is ${GMICLOUD_MAX_INPUT_CHARACTERS} per request. Split the text into shorter requests.`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    const requestModel = resolveMappedModelId(request.model, options);
    const { body, format } = buildGmicloudSpeechRequest(request, requestModel);
    const pricing = await getModelPricing(request.model, provider, options.pricingContext);
    const baseURL = normalizeGmicloudBaseURL(options.baseURL);

    log('request-queue request: model=%s format=%s', requestModel, format);

    const response = await fetch(`${baseURL}${GMICLOUD_QUEUE_PATH}`, {
      body: JSON.stringify(body),
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: options.signal,
    });

    if (!response.ok) throw await toSpeechError(response);

    const { data, audioUrl } = await resolveGmicloudResult(await response.json(), options);
    if (data?.status !== 'success' || !audioUrl) {
      throw new GmicloudSpeechError(
        `GMI Cloud speech failed: status=${JSON.stringify(data?.status)}, request_id=${JSON.stringify(data?.request_id)}`,
        AgentRuntimeErrorType.ProviderBizError,
        { request_id: data?.request_id, status: data?.status },
      );
    }

    const audioResponse = await fetch(audioUrl, { signal: options.signal });
    if (!audioResponse.ok) throw await toSpeechError(audioResponse);
    const audio = await audioResponse.arrayBuffer();

    if (audio.byteLength === 0) {
      throw new GmicloudSpeechError(
        'GMI Cloud returned empty audio',
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    log('request-queue done: %d bytes, request-id=%s', audio.byteLength, data?.request_id);

    const usage = convertTextToSpeechUsage(request.input, pricing);
    result = { audio, format, usage };
    await options.onUsage?.(result.usage!);
  } catch (error) {
    log('createGmicloudSpeech error: %O', error);

    if ((error as Error)?.name === 'AbortError') throw error;

    const errorType =
      error instanceof GmicloudSpeechError
        ? error.errorType
        : AgentRuntimeErrorType.ProviderBizError;

    throw AgentRuntimeError.chat({
      error: {
        message: (error as Error)?.message ?? String(error),
        ...(error instanceof GmicloudSpeechError ? error.detail : undefined),
      },
      errorType,
      provider,
    } satisfies ChatCompletionErrorPayload);
  }

  return result;
}
