import { AgentRuntimeErrorType } from '@lobechat/types';
import createDebug from 'debug';

import type { ChatCompletionErrorPayload } from '../../types';
import type { ILobeAgentRuntimeErrorType } from '../../types/error';
import type {
  CreateMusicOptions,
  CreateMusicPayload,
  CreateMusicResult,
  MusicTrack,
  PollMusicStatusResult,
} from '../../types/music';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../utils/modelIdMapping';
import { waitForMusicCompletion } from '../../utils/musicPolling';

const log = createDebug('lobe-music:suno');

/**
 * Suno has no first-party public API; this runtime targets the widely used
 * `sunoapi.org`-style gateway (`POST /api/v1/generate` + `GET /api/v1/generate/record-info`).
 * Point `baseURL` at any compatible host.
 */
export const DEFAULT_SUNO_BASE_URL = 'https://api.sunoapi.org';

/** LobeHub model ids → Suno model versions. Ids already in Suno form pass through. */
export const SUNO_MODEL_VERSIONS: Record<string, string> = {
  'suno-v4': 'V4',
  'suno-v4.5': 'V4_5',
  'suno-v4.5-all': 'V4_5ALL',
  'suno-v4.5-plus': 'V4_5PLUS',
  'suno-v5': 'V5',
  'suno-v5.5': 'V5_5',
  'suno-v6': 'V6',
  'suno-v6-mini': 'V6_MINI',
  'suno-v6-wild': 'V6_WILD',
};

/** Gateway `code` (also used as HTTP status) → runtime error type */
const SUNO_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  400: AgentRuntimeErrorType.InvalidRequestFormat,
  401: AgentRuntimeErrorType.InvalidProviderAPIKey,
  403: AgentRuntimeErrorType.PermissionDenied,
  405: AgentRuntimeErrorType.RateLimitExceeded,
  413: AgentRuntimeErrorType.InvalidRequestFormat,
  429: AgentRuntimeErrorType.InsufficientQuota,
  430: AgentRuntimeErrorType.RateLimitExceeded,
  455: AgentRuntimeErrorType.ProviderServiceUnavailable,
  500: AgentRuntimeErrorType.ProviderServiceUnavailable,
  503: AgentRuntimeErrorType.ProviderServiceUnavailable,
};

const SUNO_PENDING_STATUSES = new Set(['PENDING', 'TEXT_SUCCESS', 'FIRST_SUCCESS']);

/** Terminal task failures → runtime error type */
const SUNO_TASK_FAILURE_TYPES: Record<string, ILobeAgentRuntimeErrorType> = {
  CALLBACK_EXCEPTION: AgentRuntimeErrorType.ProviderBizError,
  CREATE_TASK_FAILED: AgentRuntimeErrorType.ProviderBizError,
  GENERATE_AUDIO_FAILED: AgentRuntimeErrorType.ProviderBizError,
  SENSITIVE_WORD_ERROR: AgentRuntimeErrorType.ContentModeration,
};

export const getSunoErrorType = (code: number): ILobeAgentRuntimeErrorType =>
  SUNO_ERROR_TYPES[code] ?? AgentRuntimeErrorType.ProviderBizError;

export interface SunoMusicOptions extends ModelIdMappingOptions, CreateMusicOptions {
  apiKey: string;
  baseURL: string;
  provider: string;
}

interface SunoEnvelope<T> {
  code: number;
  data?: T | null;
  msg?: string;
}

/** The gateway has shipped both snake_case and camelCase track fields. */
interface SunoTrack {
  audio_url?: string;
  audioUrl?: string;
  duration?: number;
  id?: string;
  image_url?: string;
  imageUrl?: string;
  stream_audio_url?: string;
  streamAudioUrl?: string;
  tags?: string;
  title?: string;
}

interface SunoRecordInfo {
  errorCode?: number | null;
  errorMessage?: string | null;
  response?: { sunoData?: SunoTrack[] | null; taskId?: string } | null;
  status?: string;
  taskId?: string;
}

class SunoError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const resolveSunoModelVersion = (model: string) =>
  SUNO_MODEL_VERSIONS[model.toLowerCase()] ?? model;

/**
 * Map the provider-neutral payload onto a Suno generate request. Lyrics, style or title switch
 * the request to custom mode, where `prompt` carries the lyrics and `style` / `title` apply.
 */
export const buildSunoMusicRequest = (
  payload: CreateMusicPayload,
  modelVersion: string,
  callbackUrl?: string,
): Record<string, unknown> => {
  const {
    instrumental = false,
    lyrics,
    negativeStyle,
    prompt,
    referenceAudioUrl,
    style,
    title,
    vocalGender,
  } = payload.params;
  const customMode = Boolean(lyrics?.trim() || style?.trim() || title?.trim());

  if (customMode) {
    if (!style?.trim()) {
      throw new SunoError(
        'Suno custom mode (lyrics or title set) needs a style',
        AgentRuntimeErrorType.InvalidRequestFormat,
      );
    }
    if (!instrumental && !lyrics?.trim() && !prompt?.trim()) {
      throw new SunoError(
        'Suno needs lyrics for a song with vocals; set instrumental for an instrumental track',
        AgentRuntimeErrorType.InvalidRequestFormat,
      );
    }
  } else if (!prompt?.trim()) {
    throw new SunoError(
      'Suno music generation needs a prompt',
      AgentRuntimeErrorType.InvalidRequestFormat,
    );
  }

  // In custom mode `prompt` is sung verbatim, so lyrics take precedence over the description.
  const songLyrics = lyrics?.trim() ? lyrics : undefined;
  const songPrompt = customMode ? (songLyrics ?? (instrumental ? undefined : prompt)) : prompt;

  return {
    customMode,
    instrumental,
    model: modelVersion,
    ...(songPrompt ? { prompt: songPrompt } : {}),
    ...(customMode && style ? { style } : {}),
    ...(customMode ? { title: title ?? '' } : {}),
    ...(customMode && negativeStyle ? { negativeTags: negativeStyle } : {}),
    ...(customMode && vocalGender ? { vocalGender } : {}),
    ...(!customMode && referenceAudioUrl ? { audioUrls: [referenceAudioUrl] } : {}),
    ...(callbackUrl ? { callBackUrl: callbackUrl } : {}),
  };
};

const toTrack = (track: SunoTrack): MusicTrack => {
  const audioUrl = track.audioUrl || track.audio_url;
  const streamAudioUrl = track.streamAudioUrl || track.stream_audio_url;
  const imageUrl = track.imageUrl || track.image_url;

  return {
    contentType: 'audio/mpeg',
    ...(audioUrl ? { audioUrl } : {}),
    ...(typeof track.duration === 'number' ? { duration: track.duration } : {}),
    ...(track.id ? { id: track.id } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(streamAudioUrl ? { streamAudioUrl } : {}),
    ...(track.tags ? { tags: track.tags } : {}),
    ...(track.title ? { title: track.title } : {}),
  };
};

const sunoFetch = async <T>(
  url: string,
  init: RequestInit & { apiKey: string },
): Promise<T | null | undefined> => {
  const { apiKey, headers, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: { ...headers, Authorization: `Bearer ${apiKey}` },
  });

  let envelope: SunoEnvelope<T> | undefined;
  try {
    envelope = (await response.json()) as SunoEnvelope<T>;
  } catch {
    envelope = undefined;
  }

  // The gateway reports failures in the envelope `code`, often with HTTP 200.
  const code = !response.ok ? response.status : envelope?.code;
  if (code !== 200 || !envelope) {
    const errorCode = code ?? response.status;
    throw new SunoError(
      `Suno API error (${errorCode}): ${envelope?.msg || response.statusText || 'invalid response'}`,
      envelope
        ? getSunoErrorType(errorCode)
        : (SUNO_ERROR_TYPES[response.status] ?? AgentRuntimeErrorType.UpstreamMalformedResponse),
      { code: errorCode, status: response.status },
    );
  }

  return envelope.data;
};

const toRuntimeError = (error: unknown, provider: string) => {
  if ((error as Error)?.name === 'AbortError') return error;
  // Already a runtime error payload, e.g. a polling failure or timeout.
  if (error && typeof error === 'object' && 'errorType' in error && !(error instanceof SunoError))
    return error;

  return AgentRuntimeError.chat({
    error: {
      message: (error as Error)?.message ?? String(error),
      ...(error instanceof SunoError ? error.detail : undefined),
    },
    errorType:
      error instanceof SunoError ? error.errorType : AgentRuntimeErrorType.ProviderBizError,
    provider,
  } satisfies ChatCompletionErrorPayload);
};

/** Query a Suno task once and normalize its status. */
export async function pollSunoMusicStatus(
  taskId: string,
  options: Pick<SunoMusicOptions, 'apiKey' | 'baseURL' | 'provider' | 'signal'>,
): Promise<PollMusicStatusResult> {
  try {
    const url = new URL(`${options.baseURL.replace(/\/+$/, '')}/api/v1/generate/record-info`);
    url.searchParams.set('taskId', taskId);

    const record = await sunoFetch<SunoRecordInfo>(url.toString(), {
      apiKey: options.apiKey,
      method: 'GET',
      signal: options.signal,
    });
    const status = record?.status ?? 'PENDING';

    log('record-info: taskId=%s status=%s', taskId, status);

    if (status === 'SUCCESS') {
      const tracks = (record?.response?.sunoData ?? []).map(toTrack).filter((t) => t.audioUrl);
      if (tracks.length === 0) {
        return {
          error: 'Suno task succeeded without audio',
          errorType: AgentRuntimeErrorType.UpstreamMalformedResponse,
          status: 'failed',
        };
      }

      return { status: 'success', tracks };
    }

    if (SUNO_PENDING_STATUSES.has(status)) return { status: 'pending' };

    return {
      error: record?.errorMessage || `Suno task ${status}`,
      errorType: SUNO_TASK_FAILURE_TYPES[status] ?? AgentRuntimeErrorType.ProviderBizError,
      status: 'failed',
    };
  } catch (error) {
    throw toRuntimeError(error, options.provider);
  }
}

/**
 * Submit a Suno generation task. Returns `pending` with the task id by default; with
 * `waitForCompletion` it polls the task until it finishes, fails, or runs out of time.
 */
export async function createSunoMusic(
  payload: CreateMusicPayload,
  options: SunoMusicOptions,
): Promise<CreateMusicResult> {
  const { apiKey, baseURL, provider } = options;

  try {
    const modelVersion = resolveSunoModelVersion(resolveMappedModelId(payload.model, options));
    const body = buildSunoMusicRequest(payload, modelVersion, options.callbackUrl);

    log('generate request: model=%s customMode=%s', modelVersion, body.customMode);

    const data = await sunoFetch<{ taskId?: string }>(
      `${baseURL.replace(/\/+$/, '')}/api/v1/generate`,
      {
        apiKey,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: options.signal,
      },
    );

    const taskId = data?.taskId;
    if (!taskId) {
      throw new SunoError(
        'Suno response is missing taskId',
        AgentRuntimeErrorType.UpstreamMalformedResponse,
      );
    }

    if (!options.waitForCompletion) return { inferenceId: taskId, status: 'pending' };

    const tracks = await waitForMusicCompletion(() => pollSunoMusicStatus(taskId, options), {
      maxAttempts: options.maxAttempts,
      pollIntervalMs: options.pollIntervalMs,
      provider,
      signal: options.signal,
      taskId,
      timeoutMs: options.timeoutMs,
    });

    return { inferenceId: taskId, status: 'success', tracks };
  } catch (error) {
    log('createSunoMusic error: %O', error);
    throw toRuntimeError(error, provider);
  }
}
