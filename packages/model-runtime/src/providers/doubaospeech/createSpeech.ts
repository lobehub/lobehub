import { AgentRuntimeErrorType } from '@lobechat/types';
import createDebug from 'debug';
import type { TTSAudioFormat } from 'model-bank';
import {
  DEFAULT_TTS_AUDIO_FORMAT,
  DOUBAO_SPEECH_DEFAULT_VOICE_ID,
  DOUBAO_SPEECH_VOICE_IDS,
  validateTTSParams,
} from 'model-bank';
import doubaoSpeechModels from 'model-bank/doubaospeech';

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

const log = createDebug('lobe-tts:doubaospeech');

export const DEFAULT_DOUBAO_SPEECH_BASE_URL = 'https://openspeech.bytedance.com';

/**
 * Characters per request. The audio comes back in one inline response, so a longer request
 * would exceed the serverless response limit only after the synthesis was billed. Enforced
 * here as well as in the TTS service, so routed aliases are capped too.
 */
export const DOUBAO_SPEECH_MAX_INPUT_CHARACTERS = 4096;

/** Final frame of a successful V3 synthesis. */
const DOUBAO_SPEECH_DONE_CODE = 20_000_000;

/** `audio_params.format` per standard format; `ogg_opus` is always 48 kHz. */
const DOUBAO_SPEECH_FORMATS: Partial<Record<TTSAudioFormat, string>> = {
  mp3: 'mp3',
  opus: 'ogg_opus',
  pcm: 'pcm',
  wav: 'wav',
};

/** Credentials of either console: a new-console API key, or a legacy App ID + Access Token. */
export interface DoubaoSpeechCredentials {
  accessToken?: string;
  apiKey?: string;
  appId?: string;
}

export interface DoubaoSpeechOptions
  extends DoubaoSpeechCredentials, ModelIdMappingOptions, TextToSpeechOptions {
  /** API host, e.g. `https://openspeech.bytedance.com`. */
  baseURL: string;
  /** Provider id used for pricing lookup and error payloads. */
  provider: string;
}

/** Thrown inside the request flow and unwrapped into a runtime error payload. */
class DoubaoSpeechError extends Error {
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

/** Accepts the host with or without a trailing `/api/v3`, since users often paste either. */
export const normalizeDoubaoSpeechBaseURL = (baseURL?: string | null) => {
  const url = trimTrailing(baseURL?.trim() || DEFAULT_DOUBAO_SPEECH_BASE_URL, '/');
  return url.endsWith('/api/v3') ? url.slice(0, -7) : url;
};

/**
 * Auth headers: the new console's `X-Api-Key`, or the legacy console's App ID + Access
 * Token. An API key wins when both are configured.
 * @see https://www.volcengine.com/docs/6561/2528925
 * @see https://www.volcengine.com/docs/6561/1598757
 */
export const buildDoubaoSpeechAuthHeaders = ({
  accessToken,
  apiKey,
  appId,
}: DoubaoSpeechCredentials): Record<string, string> | undefined => {
  if (apiKey?.trim()) return { 'X-Api-Key': apiKey.trim() };
  if (appId?.trim() && accessToken?.trim()) {
    return { 'X-Api-Access-Key': accessToken.trim(), 'X-Api-App-Id': appId.trim() };
  }
};

/**
 * Voice clones (`S_*`) are spoken by the voice-cloning resource of the same generation,
 * not the synthesis one; a mismatched resource is rejected upstream. Both 2.0 resources
 * are billed at the same per-character price.
 * @see https://www.volcengine.com/docs/6561/1359370
 */
const DOUBAO_SPEECH_CLONE_RESOURCES: Record<string, string> = {
  'seed-tts-1.0': 'seed-icl-1.0',
  'seed-tts-1.0-concurr': 'seed-icl-1.0-concurr',
  'seed-tts-2.0': 'seed-icl-2.0',
};

/**
 * Documented `X-Api-Resource-Id` values. Anything else is a typo or an invented id, so it is
 * refused before the request instead of spending a round trip on an upstream rejection.
 * @see https://www.volcengine.com/docs/6561/1598757
 */
export const DOUBAO_SPEECH_RESOURCES: ReadonlySet<string> = new Set([
  ...Object.keys(DOUBAO_SPEECH_CLONE_RESOURCES),
  ...Object.values(DOUBAO_SPEECH_CLONE_RESOURCES),
]);

/** `X-Api-Resource-Id` for a model and voice: the cloning resource for a voice clone. */
export const resolveDoubaoSpeechResource = (model: string, speaker: string) =>
  speaker.startsWith('S_') ? (DOUBAO_SPEECH_CLONE_RESOURCES[model] ?? model) : model;

export const DOUBAO_SPEECH_MISSING_CREDENTIALS_MESSAGE =
  'Doubao Speech needs an API Key, or an App ID together with its Access Token';

/** Standard 0.5x–2x multiplier onto the V3 -50..100 percentage scale. */
const toRate = (value: number) => Math.round((value - 1) * 100);

/**
 * Map the standard TTS payload onto a V3 `req_params`. Only parameters the caller set are
 * sent, so the voice keeps its own defaults otherwise.
 */
export const buildDoubaoSpeechRequest = (
  payload: TextToSpeechPayload,
  uid: string,
): { body: Record<string, unknown>; format: TTSAudioFormat } => {
  const speaker = payload.voice?.trim();
  if (!speaker) {
    throw new DoubaoSpeechError(
      'Doubao Speech requires a voice id',
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  const params = resolveTextToSpeechParams(payload);
  const format = params.format ?? DEFAULT_TTS_AUDIO_FORMAT;
  const upstreamFormat = DOUBAO_SPEECH_FORMATS[format];
  if (!upstreamFormat) {
    throw new DoubaoSpeechError(
      `Doubao Speech does not support the "${format}" format`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  const audioParams: Record<string, unknown> = { format: upstreamFormat };
  // Opus is only produced at 48 kHz: refuse another explicit rate rather than silently
  // returning audio at a rate the caller did not ask for.
  if (format === 'opus') {
    if (params.sampleRate !== undefined && params.sampleRate !== 48_000) {
      throw new DoubaoSpeechError(
        `Doubao Speech opus is only produced at 48000 Hz; ${params.sampleRate} Hz is not supported`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }
    audioParams.sample_rate = 48_000;
  } else if (params.sampleRate !== undefined) audioParams.sample_rate = params.sampleRate;
  if (params.speed !== undefined) audioParams.speech_rate = toRate(params.speed);
  if (params.volume !== undefined) audioParams.loudness_rate = toRate(params.volume);

  const reqParams: Record<string, unknown> = {
    audio_params: audioParams,
    speaker,
    text: payload.input,
  };
  // `additions` is a JSON string, not an object.
  if (params.pitch !== undefined && params.pitch !== 0) {
    reqParams.additions = JSON.stringify({ post_process: { pitch: Math.round(params.pitch) } });
  }

  return { body: { req_params: reqParams, user: { uid } }, format };
};

interface DoubaoSpeechFrame {
  code?: number;
  data?: string | null;
  header?: { code?: number; message?: string };
  message?: string;
  usage?: { text_words?: number };
}

/**
 * Error type for a V3 failure. The 8-digit codes are coarse (45000000 covers bad input,
 * concurrency and voice permission alike), so the message decides first.
 * @see https://www.volcengine.com/docs/6561/2534853
 */
const classifyDoubaoSpeechError = (
  httpStatus: number,
  message: string,
): ILobeAgentRuntimeErrorType => {
  if (/quota exceeded for types:\s*concurrency|too many requests|rate limit/i.test(message))
    return AgentRuntimeErrorType.RateLimitExceeded;
  if (/quota exceeded|insufficient|balance|arrear|欠费|余额/i.test(message))
    return AgentRuntimeErrorType.InsufficientQuota;
  if (/speaker permission denied|access denied/i.test(message))
    return AgentRuntimeErrorType.PermissionDenied;
  if (
    /grant not found|invalid (?:api[\s_-]?key|x-api-key|token|app[\s_-]?id|access[\s_-]?key)|authenticat|unauthori[sz]ed|api key (?:is )?(?:invalid|not found)/i.test(
      message,
    )
  )
    return AgentRuntimeErrorType.InvalidProviderAPIKey;

  if (httpStatus === 401) return AgentRuntimeErrorType.InvalidProviderAPIKey;
  if (httpStatus === 403) return AgentRuntimeErrorType.PermissionDenied;
  if (httpStatus === 429) return AgentRuntimeErrorType.RateLimitExceeded;
  return AgentRuntimeErrorType.ProviderBizError;
};

/** Extra guidance for errors whose upstream wording is not actionable on its own. */
const errorHint = (errorType: ILobeAgentRuntimeErrorType, message: string) => {
  if (/mismatched with speaker/i.test(message))
    return 'The voice does not belong to this model version, or the Doubao Speech 2.0 service is not enabled for the account.';
  if (errorType === AgentRuntimeErrorType.PermissionDenied)
    return 'Enable the voice for this account in the Volcengine speech console, or pick another voice.';
};

const toSpeechError = (
  httpStatus: number,
  frame: DoubaoSpeechFrame | undefined,
  fallbackMessage: string,
  logId?: string | null,
): DoubaoSpeechError => {
  const code = frame?.code ?? frame?.header?.code;
  const message = frame?.message || frame?.header?.message || fallbackMessage;
  const errorType = classifyDoubaoSpeechError(httpStatus, message);
  const hint = errorHint(errorType, message);
  const label = code ? `${httpStatus}, code ${code}` : `${httpStatus}`;

  return new DoubaoSpeechError(
    `Doubao Speech API error (${label}): ${hint ? `${trimTrailing(message, '.')}. ${hint}` : message}`,
    errorType,
    { code, logId: logId ?? undefined, status: httpStatus },
  );
};

const parseFrame = (line: string): DoubaoSpeechFrame | undefined => {
  try {
    const frame = JSON.parse(line);
    return frame && typeof frame === 'object' ? (frame as DoubaoSpeechFrame) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Split a V3 response into its top-level JSON frames. Frames are newline-delimited, but
 * frames written back to back are tolerated too; braces inside strings (e.g. an error
 * message) do not split a frame. Text outside any object is kept as its own chunk so it
 * fails to parse instead of being dropped.
 */
export const splitDoubaoSpeechFrames = (body: string): string[] => {
  const frames: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = 0;

  const push = (end: number) => {
    const frame = body.slice(start, end).trim();
    if (frame) frames.push(frame);
    start = end;
  };

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) push(i);
      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0) push(i + 1);
    }
  }
  push(body.length);

  return frames;
};

/**
 * Read the V3 chunked response: each frame carries a base64 audio chunk (`code` 0) until
 * the `20000000` frame, which may report the billed `usage.text_words`. A response that
 * ends without that frame or without audio is an error, so a cut stream is never billed
 * as a success.
 */
export const readDoubaoSpeechFrames = (
  body: string,
  httpStatus: number,
  logId?: string | null,
): { audio: ArrayBuffer; textWords?: number } => {
  const chunks: Uint8Array[] = [];
  let done = false;
  let textWords: number | undefined;

  for (const line of splitDoubaoSpeechFrames(body)) {
    const frame = parseFrame(line);
    if (!frame) {
      throw new DoubaoSpeechError(
        'Doubao Speech returned an unreadable response frame',
        AgentRuntimeErrorType.ProviderBizError,
        { logId: logId ?? undefined },
      );
    }

    const code = frame.code ?? frame.header?.code ?? 0;
    if (code === DOUBAO_SPEECH_DONE_CODE) {
      done = true;
      if (typeof frame.usage?.text_words === 'number') textWords = frame.usage.text_words;
      break;
    }
    if (code !== 0) throw toSpeechError(httpStatus, frame, 'synthesis failed', logId);
    if (frame.data) chunks.push(Uint8Array.from(Buffer.from(frame.data, 'base64')));
  }

  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (!done || byteLength === 0) {
    throw new DoubaoSpeechError(
      done
        ? 'Doubao Speech returned empty audio'
        : 'Doubao Speech response ended before the synthesis finished',
      AgentRuntimeErrorType.ProviderBizError,
      { logId: logId ?? undefined },
    );
  }

  const audio = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { audio: audio.buffer, textWords };
};

/** Opaque per-user id for `user.uid`, so the raw LobeHub user id never leaves the server. */
const hashUid = async (user?: string) => {
  if (!user) return 'lobehub';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};

/**
 * Synthesize speech with Doubao Speech's V3 `POST /api/v3/tts/unidirectional`. The model id
 * is the `X-Api-Resource-Id`; usage is the billed `usage.text_words` when the final frame
 * reports it, otherwise the input character count (Doubao bills one per character).
 * @see https://www.volcengine.com/docs/6561/2528925
 */
export async function createDoubaoSpeech(
  request: TextToSpeechPayload,
  options: DoubaoSpeechOptions,
): Promise<TextToSpeechResponse> {
  const { provider } = options;
  const baseURL = normalizeDoubaoSpeechBaseURL(options.baseURL);

  // A caller-omitted voice may have been filled from another vendor's default (e.g. a routed
  // alias without a static card gets `alloy`); use the Doubao Speech default instead.
  const payload: TextToSpeechPayload =
    request.voiceIsDefault && !DOUBAO_SPEECH_VOICE_IDS.has(request.voice)
      ? { ...request, voice: DOUBAO_SPEECH_DEFAULT_VOICE_ID }
      : request;
  const requestModel = resolveMappedModelId(payload.model, options);

  let result: TextToSpeechResponse;
  try {
    const authHeaders = buildDoubaoSpeechAuthHeaders(options);
    if (!authHeaders) {
      throw new DoubaoSpeechError(
        DOUBAO_SPEECH_MISSING_CREDENTIALS_MESSAGE,
        AgentRuntimeErrorType.InvalidProviderAPIKey,
      );
    }

    if (!DOUBAO_SPEECH_RESOURCES.has(requestModel)) {
      throw new DoubaoSpeechError(
        `Unknown Doubao Speech model "${requestModel}"; expected one of ${[...DOUBAO_SPEECH_RESOURCES].join(', ')}`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    // A mapped alias matches no card in the TTS service, so validate against the resolved
    // model's card before anything reaches Doubao.
    const card = doubaoSpeechModels.find((model) => model.id === requestModel);
    const issues = card?.parameters
      ? validateTTSParams(card.parameters, resolveTextToSpeechParams(payload))
      : [];
    if (issues.length > 0) {
      throw new DoubaoSpeechError(
        `Doubao Speech ${requestModel}: ${issues.map(({ key, reason }) => `params.${key} ${reason}`).join('; ')}`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    const inputCharacters = countTextToSpeechCharacters(payload.input);
    if (inputCharacters > DOUBAO_SPEECH_MAX_INPUT_CHARACTERS) {
      throw new DoubaoSpeechError(
        `Doubao Speech input is ${inputCharacters} characters; the limit is ${DOUBAO_SPEECH_MAX_INPUT_CHARACTERS} per request. Split the text into shorter requests.`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }
    if (!payload.input.trim()) {
      throw new DoubaoSpeechError(
        'Doubao Speech input is empty',
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    const { body, format } = buildDoubaoSpeechRequest(payload, await hashUid(options.user));
    const speaker = (body.req_params as { speaker: string }).speaker;
    const resource = resolveDoubaoSpeechResource(requestModel, speaker);
    // Alias-specific pricing wins; an unpriced alias falls back to the model actually called.
    const pricing =
      (await getModelPricing(payload.model, provider, options.pricingContext)) ??
      (requestModel !== payload.model
        ? await getModelPricing(requestModel, provider, options.pricingContext)
        : undefined);

    log('tts request: resource=%s speaker=%s format=%s', resource, speaker, format);

    const response = await fetch(`${baseURL}/api/v3/tts/unidirectional`, {
      body: JSON.stringify(body),
      headers: {
        ...options.headers,
        ...authHeaders,
        'Content-Type': 'application/json',
        'X-Api-Request-Id': crypto.randomUUID(),
        'X-Api-Resource-Id': resource,
        'X-Control-Require-Usage-Tokens-Return': 'text_words',
      },
      method: 'POST',
      signal: options.signal,
    });

    const logId = response.headers.get('x-tt-logid');
    const text = await response.text();

    if (!response.ok) {
      const [firstLine] = splitDoubaoSpeechFrames(text);
      throw toSpeechError(
        response.status,
        firstLine ? parseFrame(firstLine) : undefined,
        text.slice(0, 500) || response.statusText || 'request failed',
        logId,
      );
    }

    const { audio, textWords } = readDoubaoSpeechFrames(text, response.status, logId);

    log('tts done: %d bytes, text_words=%s, logid=%s', audio.byteLength, textWords, logId);

    const usage = convertTextToSpeechUsage(
      payload.input,
      pricing,
      textWords === undefined ? undefined : { inputCharacters: textWords },
    );

    result = { audio, format, usage };
  } catch (error) {
    log('createDoubaoSpeech error: %O', error);

    if ((error as Error)?.name === 'AbortError') throw error;

    const errorType =
      error instanceof DoubaoSpeechError ? error.errorType : AgentRuntimeErrorType.ProviderBizError;

    throw AgentRuntimeError.chat({
      error: {
        message: (error as Error)?.message ?? String(error),
        ...(error instanceof DoubaoSpeechError ? error.detail : undefined),
      },
      errorType,
      provider,
    } satisfies ChatCompletionErrorPayload);
  }

  await options.onUsage?.(result.usage!);

  return result;
}
