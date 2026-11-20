import debug from 'debug';

import type { ILobeAgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeErrorType } from '../../types/error';
import type {
  CreateMusicOptions,
  CreateMusicResult,
  MusicGenerationParams,
  MusicTrack,
  PollMusicStatusResult,
} from '../../types/music';
import { AgentRuntimeError } from '../../utils/createError';
import { waitForMusicCompletion } from '../../utils/musicPolling';
import { parseFalVideoInferenceId, toFalVideoInferenceId } from './createVideo';
import type { FalJsonSchema } from './schema';
import { coerceFalInput } from './schema';

const log = debug('lobe-music:fal');

/** fal's queue API: submit with `POST /<endpoint>`, then poll `/<app>/requests/<id>[/status]` */
export const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';

const PROVIDER = 'fal';

/** Lyrics ACE-Step treats as "no vocals" */
const ACE_STEP_INSTRUMENTAL_LYRICS = '[Instrumental]';

const hasText = (value?: string): value is string => !!value && value.trim().length > 0;

const joinText = (...parts: (string | undefined)[]) => parts.filter(hasText).join(', ');

type FalMusicInputBuilder = (params: MusicGenerationParams) => Record<string, unknown>;

/**
 * Built-in fal music endpoints and how each maps the provider-neutral params onto its input
 * schema. Field names and limits follow each endpoint's OpenAPI schema on fal.
 */
const FAL_MUSIC_INPUT_BUILDERS: Record<string, FalMusicInputBuilder> = {
  // https://fal.ai/models/fal-ai/ace-step-1.5/api
  'fal-ai/ace-step-1.5': ({ duration, instrumental, lyrics, prompt, style }) => {
    const input: Record<string, unknown> = {
      // The caption carries both the description and the style tags
      prompt: joinText(prompt, style),
      lyrics: instrumental ? ACE_STEP_INSTRUMENTAL_LYRICS : (lyrics ?? ''),
      num_outputs: 1,
    };
    if (duration) input.duration = duration;
    return input;
  },

  // https://fal.ai/models/fal-ai/minimax-music/api — the legacy endpoint's `prompt` is the lyrics
  'fal-ai/minimax-music': ({ lyrics, prompt, referenceAudioUrl }) => ({
    prompt: hasText(lyrics) ? lyrics : (prompt ?? ''),
    reference_audio_url: referenceAudioUrl,
  }),

  // https://fal.ai/models/fal-ai/minimax-music/v2.6/api
  'fal-ai/minimax-music/v2.6': ({
    bitrate,
    format,
    instrumental,
    lyrics,
    lyricsOptimizer,
    prompt,
    sampleRate,
    style,
  }) => {
    const input: Record<string, unknown> = { prompt: joinText(prompt, style) };

    if (instrumental) {
      input.is_instrumental = true;
    } else if (hasText(lyrics)) {
      input.lyrics = lyrics;
    } else {
      // fal requires lyrics for a vocal track; without any, let MiniMax write them
      input.lyrics_optimizer = true;
    }
    if (lyricsOptimizer && !instrumental) input.lyrics_optimizer = true;

    const audioSetting: Record<string, unknown> = {};
    if (format) audioSetting.format = format;
    if (sampleRate) audioSetting.sample_rate = sampleRate;
    if (bitrate) audioSetting.bitrate = bitrate;
    if (Object.keys(audioSetting).length > 0) input.audio_setting = audioSetting;

    return input;
  },

  // https://fal.ai/models/minimax/music-3/api
  'minimax/music-3': ({ duration, lyrics, prompt, style }) => {
    const input: Record<string, unknown> = {
      lyrics: lyrics ?? '',
      prompt: joinText(prompt, style),
    };
    if (duration) input.duration = duration;
    return input;
  },
};

export const isBuiltinFalMusicModel = (model: string) =>
  Object.hasOwn(FAL_MUSIC_INPUT_BUILDERS, model);

/** Fields of any other fal audio endpoint, fitted to its schema by `coerceFalInput` */
const buildGenericFalMusicInput: FalMusicInputBuilder = ({
  duration,
  instrumental,
  lyrics,
  prompt,
  referenceAudioUrl,
  style,
}) => {
  const input: Record<string, unknown> = { prompt: joinText(prompt, style) };
  if (hasText(lyrics) && !instrumental) input.lyrics = lyrics;
  if (instrumental) input.instrumental = true;
  if (duration) input.duration = duration;
  if (referenceAudioUrl) input.reference_audio_url = referenceAudioUrl;
  return input;
};

export const buildFalMusicInput = (model: string, params: MusicGenerationParams) =>
  (FAL_MUSIC_INPUT_BUILDERS[model] ?? buildGenericFalMusicInput)(params);

const readFalErrorBody = async (response: Response): Promise<unknown> => {
  const text = await response.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** fal puts the reason in `detail`: a string, or a list of validation errors with `msg` */
export const getFalMusicErrorMessage = (body: unknown, fallback: string): string => {
  if (typeof body === 'string' && body) return body;
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item as { msg?: unknown } | undefined)?.msg)
      .filter((msg): msg is string => typeof msg === 'string');
    if (messages.length > 0) return messages.join('; ');
  }
  const error = (body as { error?: unknown } | undefined)?.error;
  if (typeof error === 'string') return error;

  return fallback;
};

const hasContentPolicyViolation = (body: unknown) => {
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return (
    Array.isArray(detail) &&
    detail.some(
      (item) => (item as { type?: unknown } | undefined)?.type === 'content_policy_violation',
    )
  );
};

/**
 * Map a fal HTTP failure to a runtime error type.
 * https://docs.fal.ai/model-apis/errors/
 * - 401: the key is wrong or revoked
 * - 403: the account is locked, which fal does when the balance is exhausted ("Exhausted balance")
 * - 422 with `content_policy_violation`: the prompt or lyrics were rejected
 */
export const toFalMusicErrorType = (status: number, body: unknown): ILobeAgentRuntimeErrorType => {
  if (status === 401) return AgentRuntimeErrorType.InvalidProviderAPIKey;
  if (status === 403) {
    const message = getFalMusicErrorMessage(body, '');
    return /balance|credit|billing|locked|payment/i.test(message) || !message
      ? AgentRuntimeErrorType.InsufficientQuota
      : AgentRuntimeErrorType.PermissionDenied;
  }
  if (status === 404) return AgentRuntimeErrorType.ModelNotFound;
  if (status === 429) return AgentRuntimeErrorType.RateLimitExceeded;
  if (status === 422 && hasContentPolicyViolation(body))
    return AgentRuntimeErrorType.ContentModeration;
  if (status >= 500) return AgentRuntimeErrorType.ProviderServiceUnavailable;

  return AgentRuntimeErrorType.ProviderBizError;
};

const toFalMusicHttpError = async (response: Response, endpoint: string) => {
  const body = await readFalErrorBody(response);
  const message = getFalMusicErrorMessage(body, `fal returned HTTP ${response.status}`);

  return AgentRuntimeError.chat({
    error: { body, endpoint, message, status: response.status },
    errorType: toFalMusicErrorType(response.status, body),
    provider: PROVIDER,
  });
};

/** A thrown fetch (DNS, reset, abort) is a network error unless the caller aborted it */
const fetchFal = async (url: string, init: RequestInit, endpoint: string) => {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw AgentRuntimeError.chat({
      error: { cause: error, endpoint, message: (error as Error)?.message ?? String(error) },
      errorType: AgentRuntimeErrorType.ProviderNetworkError,
      provider: PROVIDER,
    });
  }
};

interface FalFile {
  content_type?: string | null;
  file_name?: string | null;
  url?: string;
}

interface FalMusicOutput {
  audio?: FalFile;
  audios?: { audio?: FalFile; seed?: number }[];
  duration?: number | null;
}

const toTrack = (file: FalFile, duration?: number | null): MusicTrack => ({
  audioUrl: file.url,
  ...(file.content_type && file.content_type.startsWith('audio/')
    ? { contentType: file.content_type }
    : {}),
  ...(typeof duration === 'number' && duration > 0 ? { duration } : {}),
});

/** fal returns one `audio` file, or (ACE-Step) every sample under `audios` */
export const parseFalMusicOutput = (data: unknown): MusicTrack[] => {
  const output = (data ?? {}) as FalMusicOutput;
  const files = output.audios?.length
    ? output.audios.map((item) => item.audio).filter((file): file is FalFile => !!file?.url)
    : output.audio?.url
      ? [output.audio]
      : [];

  return files.map((file) => toTrack(file, output.duration));
};

/** `<owner>/<app>` of a fal endpoint id, e.g. `fal-ai/minimax-music` for `.../v2.6` */
export const toFalAppId = (endpoint: string) => endpoint.split('/').slice(0, 2).join('/');

export class FalMusicClient {
  constructor(
    private readonly apiKey: string,
    private readonly loadInputSchema?: (endpoint: string) => Promise<FalJsonSchema | undefined>,
  ) {}

  private get headers() {
    return { 'Authorization': `Key ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /** Submit the task to fal's queue; the inference id is the `<model>/requests/<id>` path */
  async submit(model: string, params: MusicGenerationParams, signal?: AbortSignal) {
    let input = buildFalMusicInput(model, params);
    if (!isBuiltinFalMusicModel(model) && this.loadInputSchema)
      input = coerceFalInput(input, await this.loadInputSchema(model));

    log('Submitting fal music request to %s with input: %O', model, input);

    const response = await fetchFal(
      `${FAL_QUEUE_BASE_URL}/${model}`,
      { body: JSON.stringify(input), headers: this.headers, method: 'POST', signal },
      model,
    );
    if (!response.ok) throw await toFalMusicHttpError(response, model);

    const { request_id } = (await response.json()) as { request_id?: string };
    if (!request_id)
      throw AgentRuntimeError.chat({
        error: { endpoint: model, message: 'fal returned no request id' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: PROVIDER,
      });

    return toFalVideoInferenceId(model, request_id);
  }

  /**
   * Query a queued task once. Pending while queued or running; once `COMPLETED` the result
   * request returns the output, or the provider error for a failed task.
   */
  async poll(inferenceId: string, signal?: AbortSignal): Promise<PollMusicStatusResult> {
    const { appId: endpoint, requestId } = parseFalVideoInferenceId(inferenceId);
    // Status and result live under `<owner>/<app>` only: fal answers 405 for a longer path such
    // as `fal-ai/minimax-music/v2.6/requests/<id>/status`
    const appId = toFalAppId(endpoint);
    const requestUrl = `${FAL_QUEUE_BASE_URL}/${appId}/requests/${requestId}`;

    const statusResponse = await fetchFal(
      `${requestUrl}/status`,
      { headers: this.headers, signal },
      appId,
    );
    if (!statusResponse.ok) {
      const error = await toFalMusicHttpError(statusResponse, appId);
      // The key stopped working mid-task: polling again cannot recover
      if (
        error.errorType === AgentRuntimeErrorType.InvalidProviderAPIKey ||
        error.errorType === AgentRuntimeErrorType.InsufficientQuota
      )
        return {
          error: (error.error as { message: string }).message,
          errorType: error.errorType,
          status: 'failed',
        };
      throw error;
    }

    const status = (await statusResponse.json()) as { error?: string | null; status?: string };
    if (status.status !== 'COMPLETED') return { status: 'pending' };

    const resultResponse = await fetchFal(requestUrl, { headers: this.headers, signal }, appId);
    if (!resultResponse.ok) {
      const body = await readFalErrorBody(resultResponse);
      log('fal music request %s failed: %O', inferenceId, body);
      return {
        error: getFalMusicErrorMessage(
          body,
          status.error || `fal music task failed with HTTP ${resultResponse.status}`,
        ),
        errorType: toFalMusicErrorType(resultResponse.status, body),
        status: 'failed',
      };
    }

    const tracks = parseFalMusicOutput(await resultResponse.json());
    if (tracks.length === 0)
      return {
        error: 'fal returned no audio',
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 'failed',
      };

    return { status: 'success', tracks };
  }

  async create(
    model: string,
    params: MusicGenerationParams,
    options: CreateMusicOptions = {},
  ): Promise<CreateMusicResult> {
    const { maxAttempts, pollIntervalMs, signal, timeoutMs, waitForCompletion } = options;
    const inferenceId = await this.submit(model, params, signal);

    if (!waitForCompletion) return { inferenceId, status: 'pending' };

    const tracks = await waitForMusicCompletion(
      (pollSignal) => this.poll(inferenceId, pollSignal),
      { maxAttempts, pollIntervalMs, provider: PROVIDER, signal, taskId: inferenceId, timeoutMs },
    );

    return { inferenceId, status: 'success', tracks };
  }

  /**
   * Verify the key with fal's platform API, which rejects an invalid key with 401 without
   * running (or billing) any model.
   */
  async checkCredentials(signal?: AbortSignal) {
    const endpoint = 'https://api.fal.ai/v1/models?limit=1';
    const response = await fetchFal(
      endpoint,
      { headers: { Authorization: `Key ${this.apiKey}` }, signal },
      endpoint,
    );
    if (!response.ok) throw await toFalMusicHttpError(response, endpoint);

    return {};
  }
}
