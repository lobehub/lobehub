import { AgentRuntimeErrorType } from '@lobechat/types';
import createDebug from 'debug';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { ChatCompletionErrorPayload } from '../../types';
import type { ILobeAgentRuntimeErrorType } from '../../types/error';
import type {
  CreateMusicOptions,
  CreateMusicPayload,
  CreateMusicResult,
  MusicTrack,
} from '../../types/music';
import { AgentRuntimeError } from '../../utils/createError';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../utils/modelIdMapping';
import { trimTrailingSlashes } from '../../utils/trimTrailingSlashes';
import { decodeMiniMaxHexAudio, getMiniMaxSpeechErrorType } from './createSpeech';

const log = createDebug('lobe-music:minimax');

/** MiniMax hosts generated songs at temporary URLs; `hex` returns the bytes inline. */
const DEFAULT_OUTPUT_FORMAT = 'url';

const MINIMAX_MUSIC_STATUS_DONE = 2;

/** Cover models re-sing a reference track; the others compose from prompt and lyrics. */
const MINIMAX_COVER_MODEL_PATTERN = /^music-cover/i;

const HTTP_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  401: AgentRuntimeErrorType.InvalidProviderAPIKey,
  403: AgentRuntimeErrorType.PermissionDenied,
  429: AgentRuntimeErrorType.RateLimitExceeded,
};

/** Music-specific codes on top of the codes MiniMax shares across its APIs. */
const MINIMAX_MUSIC_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  1026: AgentRuntimeErrorType.ContentModeration,
  2013: AgentRuntimeErrorType.InvalidRequestFormat,
};

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  pcm: 'audio/pcm',
  wav: 'audio/wav',
};

export interface MiniMaxMusicOptions extends ModelIdMappingOptions, CreateMusicOptions {
  apiKey: string;
  baseURL: string;
  headers?: Record<string, string>;
  provider: string;
}

interface MiniMaxBaseResp {
  status_code: number;
  status_msg?: string;
}

interface MiniMaxMusicResponse {
  base_resp?: MiniMaxBaseResp;
  data?: { audio?: string; status?: number } | null;
  extra_info?: {
    bitrate?: number;
    music_channel?: number;
    /** Track length in milliseconds */
    music_duration?: number;
    music_sample_rate?: number;
    music_size?: number;
  };
  trace_id?: string;
}

class MiniMaxMusicError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const getMiniMaxMusicErrorType = (statusCode: number): ILobeAgentRuntimeErrorType =>
  MINIMAX_MUSIC_ERROR_TYPES[statusCode] ?? getMiniMaxSpeechErrorType(statusCode);

const assertBaseResp = (data: MiniMaxMusicResponse) => {
  const baseResp = data.base_resp;
  if (baseResp && baseResp.status_code !== 0) {
    throw new MiniMaxMusicError(
      `MiniMax music API error: ${baseResp.status_msg || baseResp.status_code}`,
      getMiniMaxMusicErrorType(baseResp.status_code),
      { base_resp: baseResp, trace_id: data.trace_id },
    );
  }
};

/**
 * Map the provider-neutral payload onto a `/v1/music_generation` request body. Unset params
 * are omitted so MiniMax applies its defaults.
 */
export const buildMiniMaxMusicRequest = (
  payload: CreateMusicPayload,
  requestModel: string,
): Record<string, unknown> => {
  const {
    bitrate,
    format,
    instrumental,
    lyrics,
    lyricsOptimizer,
    outputFormat,
    prompt,
    referenceAudioBase64,
    referenceAudioUrl,
    sampleRate,
    stream,
    watermark,
  } = payload.params;

  const has = (value?: string) => Boolean(value?.trim());
  const invalid = (message: string) =>
    new MiniMaxMusicError(message, AgentRuntimeErrorType.InvalidRequestFormat);
  const hasReferenceAudio = Boolean(referenceAudioUrl || referenceAudioBase64);

  if (referenceAudioUrl && referenceAudioBase64) {
    throw invalid('Pass either referenceAudioUrl or referenceAudioBase64, not both');
  }

  // Validate per mode so a request MiniMax would refuse never reaches the paid endpoint.
  if (MINIMAX_COVER_MODEL_PATTERN.test(requestModel)) {
    if (!hasReferenceAudio) throw invalid('MiniMax cover models need reference audio');
    if (!has(prompt))
      throw invalid('MiniMax cover models need a prompt describing the target style');
    if (instrumental || lyricsOptimizer) {
      throw invalid('MiniMax cover models support neither instrumental nor lyricsOptimizer');
    }
  } else {
    if (hasReferenceAudio) {
      throw invalid('Reference audio is only supported by MiniMax cover models (music-cover)');
    }
    if (instrumental) {
      if (!has(prompt)) throw invalid('A MiniMax instrumental track needs a prompt');
    } else if (!has(lyrics)) {
      if (!lyricsOptimizer) {
        throw invalid(
          'MiniMax needs lyrics for a song with vocals; set lyricsOptimizer to write them from the prompt, or instrumental',
        );
      }
      if (!has(prompt))
        throw invalid('MiniMax lyricsOptimizer needs a prompt to write lyrics from');
    }
  }

  const audioSetting = {
    ...(typeof sampleRate === 'number' ? { sample_rate: sampleRate } : {}),
    ...(typeof bitrate === 'number' ? { bitrate } : {}),
    ...(format ? { format } : {}),
  };

  return {
    model: requestModel,
    // Streaming only delivers hex chunks.
    output_format: stream ? 'hex' : (outputFormat ?? DEFAULT_OUTPUT_FORMAT),
    ...(prompt ? { prompt } : {}),
    ...(lyrics ? { lyrics } : {}),
    ...(instrumental ? { is_instrumental: true } : {}),
    ...(lyricsOptimizer ? { lyrics_optimizer: true } : {}),
    ...(referenceAudioUrl ? { audio_url: referenceAudioUrl } : {}),
    ...(referenceAudioBase64 ? { audio_base64: referenceAudioBase64 } : {}),
    ...(Object.keys(audioSetting).length > 0 ? { audio_setting: audioSetting } : {}),
    ...(typeof watermark === 'boolean' && !stream ? { aigc_watermark: watermark } : {}),
    ...(stream ? { stream: true } : {}),
  };
};

const toTrack = (
  audio: string | undefined,
  data: MiniMaxMusicResponse,
  format: string,
): MusicTrack => {
  const contentType = AUDIO_CONTENT_TYPES[format] ?? 'audio/mpeg';
  const durationMs = data.extra_info?.music_duration;
  const meta = {
    contentType,
    ...(typeof durationMs === 'number' ? { duration: durationMs / 1000 } : {}),
    ...(data.trace_id ? { id: data.trace_id } : {}),
  };

  // `output_format: 'url'` puts a temporary download URL where hex output puts the bytes.
  if (typeof audio === 'string' && /^https?:\/\//i.test(audio)) {
    return { audioUrl: audio, ...meta };
  }

  try {
    return { audio: decodeMiniMaxHexAudio(audio), ...meta };
  } catch {
    throw new MiniMaxMusicError(
      'MiniMax returned no playable audio',
      AgentRuntimeErrorType.UpstreamMalformedResponse,
      { trace_id: data.trace_id },
    );
  }
};

/**
 * Read a `stream: true` response. Every SSE event carries a hex chunk with `status: 1`; the
 * final `status: 2` event carries the extra info and, like t2a_v2, may repeat the full audio.
 */
const readMiniMaxMusicStream = async (response: Response): Promise<MiniMaxMusicResponse> => {
  if (!response.body) {
    throw new MiniMaxMusicError(
      'MiniMax music stream has no body',
      AgentRuntimeErrorType.UpstreamMalformedResponse,
    );
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const chunks: string[] = [];
  let buffer = '';
  let final: MiniMaxMusicResponse | undefined;

  const handleEvent = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;

    const raw = trimmed.slice(5).trim();
    if (!raw || raw === '[DONE]') return;

    const event = JSON.parse(raw) as MiniMaxMusicResponse;
    assertBaseResp(event);

    if (event.data?.status === MINIMAX_MUSIC_STATUS_DONE) {
      final = event;
    } else if (event.data?.audio) {
      chunks.push(event.data.audio);
    }
  };

  let raw = '';
  let sawEvent = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    if (!sawEvent) raw += value;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach((line) => {
      if (line.trim().startsWith('data:')) sawEvent = true;
      handleEvent(line);
    });
  }
  if (buffer) {
    if (buffer.trim().startsWith('data:')) sawEvent = true;
    handleEvent(buffer);
  }

  // Business errors (bad key, no balance) come back as a plain JSON body, not as SSE events.
  if (!sawEvent) {
    let body: MiniMaxMusicResponse | undefined;
    try {
      body = JSON.parse(raw) as MiniMaxMusicResponse;
    } catch {
      body = undefined;
    }
    if (body) {
      assertBaseResp(body);
      return body;
    }
  }

  // Without the terminal event the connection dropped mid-song: the chunks are incomplete.
  if (!final) {
    throw new MiniMaxMusicError(
      'MiniMax music stream ended before the song finished',
      AgentRuntimeErrorType.ProviderNetworkError,
    );
  }

  return {
    ...final,
    data: { audio: final.data?.audio || chunks.join(''), status: final.data?.status },
  };
};

const readErrorBody = async (response: Response): Promise<MiniMaxMusicResponse | undefined> => {
  try {
    return (await response.json()) as MiniMaxMusicResponse;
  } catch {
    return undefined;
  }
};

/**
 * Generate a song with `/v1/music_generation`. The plain call is synchronous and returns the
 * finished song; `stream: true` assembles the streamed hex chunks. Audio comes back either as
 * a hosted URL (`outputFormat: 'url'`, the default) or as decoded bytes (`'hex'`).
 */
export async function createMiniMaxMusic(
  payload: CreateMusicPayload,
  options: MiniMaxMusicOptions,
): Promise<CreateMusicResult> {
  const { apiKey, baseURL, provider } = options;
  const requestModel = resolveMappedModelId(payload.model, options);

  try {
    const body = buildMiniMaxMusicRequest(payload, requestModel);

    log('music_generation request: model=%s stream=%s', requestModel, !!body.stream);

    const response = await fetch(`${trimTrailingSlashes(baseURL)}/music_generation`, {
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

      throw new MiniMaxMusicError(
        `MiniMax music API error (${response.status}): ${errorBody?.base_resp?.status_msg || response.statusText}`,
        HTTP_ERROR_TYPES[response.status] ??
          (statusCode ? getMiniMaxMusicErrorType(statusCode) : undefined) ??
          AgentRuntimeErrorType.ProviderBizError,
        { base_resp: errorBody?.base_resp, status: response.status },
      );
    }

    const data = body.stream
      ? await readMiniMaxMusicStream(response)
      : ((await response.json()) as MiniMaxMusicResponse);

    assertBaseResp(data);

    if (data.data?.status !== undefined && data.data.status !== MINIMAX_MUSIC_STATUS_DONE) {
      throw new MiniMaxMusicError(
        `MiniMax music task did not finish (status ${data.data.status})`,
        AgentRuntimeErrorType.ProviderBizError,
        { trace_id: data.trace_id },
      );
    }

    const format = payload.params.format ?? 'mp3';
    const track = toTrack(data.data?.audio, data, format);

    log('music_generation done: trace_id=%s url=%s', data.trace_id, !!track.audioUrl);

    return { inferenceId: data.trace_id, status: 'success', tracks: [track] };
  } catch (error) {
    log('createMiniMaxMusic error: %O', error);

    if ((error as Error)?.name === 'AbortError') throw error;

    throw AgentRuntimeError.chat({
      error: {
        message: (error as Error)?.message ?? String(error),
        ...(error instanceof MiniMaxMusicError ? error.detail : undefined),
      },
      errorType:
        error instanceof MiniMaxMusicError
          ? error.errorType
          : AgentRuntimeErrorType.ProviderBizError,
      provider,
    } satisfies ChatCompletionErrorPayload);
  }
}

/**
 * Music-only runtime the MiniMax router uses for `music-*` models, so generation always hits
 * the native API whatever SDK type serves chat.
 */
export class LobeMinimaxMusicAI implements LobeRuntimeAI {
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

  createMusic(payload: CreateMusicPayload, options?: CreateMusicOptions) {
    return createMiniMaxMusic(payload, {
      ...options,
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      modelIdMapping: this.modelIdMapping,
      provider: this.id,
    });
  }
}
