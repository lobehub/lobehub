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
import { trimTrailingSlashes } from '../../utils/trimTrailingSlashes';

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
 * Map the provider-neutral payload onto a Suno generate request. `prompt`, `lyrics` and `style`
 * work in both modes; title, negativeStyle and vocalGender exist only in custom mode, so any of
 * them switches the request to custom mode. Reference audio exists only in non-custom mode.
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
  const has = (value?: string) => Boolean(value?.trim());
  const customMode = has(title) || has(negativeStyle) || Boolean(vocalGender);

  if (customMode) {
    // Suno custom mode needs at least one of style, lyrics or negativeTags; a prompt alone
    // does not count.
    if (!has(lyrics) && !has(style) && !has(negativeStyle)) {
      throw new SunoError(
        'Suno custom mode (title, negativeStyle or vocalGender set) needs lyrics, a style, or a negative style',
        AgentRuntimeErrorType.InvalidRequestFormat,
      );
    }
    if (referenceAudioUrl) {
      throw new SunoError(
        'Suno accepts reference audio only without title, negativeStyle or vocalGender',
        AgentRuntimeErrorType.InvalidRequestFormat,
      );
    }
  } else if (!has(lyrics) && !has(style) && !referenceAudioUrl) {
    // A prompt is only the core idea: non-custom mode needs a style, lyrics or an attachment.
    throw new SunoError(
      'Suno needs a style, lyrics, or reference audio; a prompt alone is not accepted',
      AgentRuntimeErrorType.InvalidRequestFormat,
    );
  }

  return {
    customMode,
    instrumental,
    model: modelVersion,
    ...(has(prompt) ? { prompt } : {}),
    ...(has(lyrics) ? { lyrics } : {}),
    ...(has(style) ? { style } : {}),
    ...(customMode && has(title) ? { title } : {}),
    ...(customMode && has(negativeStyle) ? { negativeTags: negativeStyle } : {}),
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
    const url = new URL(`${trimTrailingSlashes(options.baseURL)}/api/v1/generate/record-info`);
    url.searchParams.set('taskId', taskId);

    const record = await sunoFetch<SunoRecordInfo>(url.toString(), {
      apiKey: options.apiKey,
      method: 'GET',
      signal: options.signal,
    });
    const status = record?.status;

    // record-info always reports one of its task statuses; anything else is not a pending task.
    if (!status) {
      return {
        error: 'Suno status response is missing the task status',
        errorType: AgentRuntimeErrorType.UpstreamMalformedResponse,
        status: 'failed',
      };
    }

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
    // The gateway rejects submissions without a webhook even when the caller only polls.
    if (!options.callbackUrl?.trim()) {
      throw new SunoError(
        'Suno requires options.callbackUrl (the gateway rejects submissions without callBackUrl)',
        AgentRuntimeErrorType.InvalidRequestFormat,
      );
    }

    const modelVersion = resolveSunoModelVersion(resolveMappedModelId(payload.model, options));
    const body = buildSunoMusicRequest(payload, modelVersion, options.callbackUrl);

    log('generate request: model=%s customMode=%s', modelVersion, body.customMode);

    const data = await sunoFetch<{ taskId?: string }>(
      `${trimTrailingSlashes(baseURL)}/api/v1/generate`,
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

    const tracks = await waitForMusicCompletion(
      (signal) => pollSunoMusicStatus(taskId, { ...options, signal }),
      {
        maxAttempts: options.maxAttempts,
        pollIntervalMs: options.pollIntervalMs,
        provider,
        signal: options.signal,
        taskId,
        timeoutMs: options.timeoutMs,
      },
    );

    return { inferenceId: taskId, status: 'success', tracks };
  } catch (error) {
    log('createSunoMusic error: %O', error);
    throw toRuntimeError(error, provider);
  }
}
