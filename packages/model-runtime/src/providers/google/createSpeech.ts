import type {
  GenerateContentConfig,
  GenerateContentParameters,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  GoogleGenAI,
  Part,
} from '@google/genai';
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
import { parseGoogleErrorMessage } from '../../utils/googleErrorParser';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../utils/modelIdMapping';
import type { PcmAudio } from './speechAudio';
import {
  decodeGeminiAudio,
  encodeMp3,
  encodeWav,
  SpeechAudioError,
  toArrayBuffer,
} from './speechAudio';

const log = createDebug('lobe-tts:google');

/** Formats the runtime can produce from Gemini's PCM output. */
export const GEMINI_TTS_FORMATS = ['mp3', 'wav', 'pcm'] as const satisfies TTSAudioFormat[];

/**
 * Gemini 2.5 and 3.1 TTS read style from the prompt itself ("Say cheerfully: ..."); later
 * models treat the text strictly as a transcript and take style from `speechMetadata`.
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */
const PROMPT_STYLED_TTS_PREFIXES = ['gemini-2.5-', 'gemini-3.1-'];

/** Plain string checks: a model id comes from the caller, so no backtracking pattern runs on it. */
export const isPromptStyledGeminiTTSModel = (model: string) => {
  const id = model.toLowerCase().split('/').pop() ?? '';

  return id.includes('tts') && PROMPT_STYLED_TTS_PREFIXES.some((prefix) => id.startsWith(prefix));
};

const HTTP_ERROR_TYPES: Record<number, ILobeAgentRuntimeErrorType> = {
  401: AgentRuntimeErrorType.InvalidProviderAPIKey,
  403: AgentRuntimeErrorType.PermissionDenied,
  404: AgentRuntimeErrorType.ModelNotFound,
  429: AgentRuntimeErrorType.RateLimitExceeded,
  500: AgentRuntimeErrorType.ProviderServiceUnavailable,
  503: AgentRuntimeErrorType.ProviderServiceUnavailable,
  504: AgentRuntimeErrorType.ProviderServiceUnavailable,
};

/**
 * Canonical Google RPC `error.status` values.
 * @see https://ai.google.dev/gemini-api/docs/troubleshooting#error-codes
 */
const GOOGLE_STATUS_ERROR_TYPES: Record<string, ILobeAgentRuntimeErrorType> = {
  DEADLINE_EXCEEDED: AgentRuntimeErrorType.ProviderServiceUnavailable,
  INTERNAL: AgentRuntimeErrorType.ProviderServiceUnavailable,
  INVALID_ARGUMENT: AgentRuntimeErrorType.ProviderBizError,
  NOT_FOUND: AgentRuntimeErrorType.ModelNotFound,
  PERMISSION_DENIED: AgentRuntimeErrorType.PermissionDenied,
  RESOURCE_EXHAUSTED: AgentRuntimeErrorType.RateLimitExceeded,
  UNAUTHENTICATED: AgentRuntimeErrorType.InvalidProviderAPIKey,
  UNAVAILABLE: AgentRuntimeErrorType.ProviderServiceUnavailable,
};

/** Finish / block reasons that mean the content was refused rather than failed. */
const MODERATION_REASONS = new Set(['BLOCKLIST', 'PROHIBITED_CONTENT', 'SAFETY', 'SPII']);

interface GoogleErrorBody {
  code?: number;
  details?: Array<{ reason?: string }>;
  message?: string;
  status?: string;
}

/** Thrown inside the request flow and unwrapped into a runtime error payload. */
class GeminiSpeechError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** The JSON error body the SDK puts in `ApiError.message`, possibly after a text prefix. */
const parseGoogleErrorBody = (message: string): GoogleErrorBody | undefined => {
  const start = message.indexOf('{');
  if (start === -1) return;

  try {
    const parsed = JSON.parse(message.slice(start));
    return parsed?.error && typeof parsed.error === 'object' ? parsed.error : undefined;
  } catch {
    return;
  }
};

/**
 * Map an SDK / HTTP failure to a runtime error type. A rejected key comes back as
 * `400 INVALID_ARGUMENT` with reason `API_KEY_INVALID`, so it is checked before the
 * generic status mapping.
 */
export const getGeminiSpeechErrorType = (
  httpStatus: number | undefined,
  body: GoogleErrorBody | undefined,
): ILobeAgentRuntimeErrorType => {
  const message = body?.message ?? '';

  if (
    body?.details?.some((detail) => detail.reason === 'API_KEY_INVALID') ||
    message.includes('API key not valid') ||
    message.includes('API key expired')
  ) {
    return AgentRuntimeErrorType.InvalidProviderAPIKey;
  }
  if (message.includes('location is not supported')) {
    return AgentRuntimeErrorType.LocationNotSupportError;
  }

  return (
    (httpStatus !== undefined ? HTTP_ERROR_TYPES[httpStatus] : undefined) ??
    (body?.status ? GOOGLE_STATUS_ERROR_TYPES[body.status] : undefined) ??
    AgentRuntimeErrorType.ProviderBizError
  );
};

const toGeminiSpeechError = (error: unknown): GeminiSpeechError => {
  if (error instanceof GeminiSpeechError) return error;
  if (error instanceof SpeechAudioError) {
    return new GeminiSpeechError(error.message, AgentRuntimeErrorType.ProviderBizError);
  }

  const rawMessage = (error as Error)?.message ?? String(error);
  const status = (error as { status?: unknown })?.status;
  const httpStatus = typeof status === 'number' ? status : undefined;
  const body = parseGoogleErrorBody(rawMessage);

  const statusLabel = body?.status ?? httpStatus;
  const message = body?.message
    ? `Gemini API error${statusLabel ? ` (${statusLabel})` : ''}: ${body.message}`
    : rawMessage;

  let errorType = getGeminiSpeechErrorType(httpStatus, body);
  if (errorType === AgentRuntimeErrorType.ProviderBizError) {
    // Fall back to the provider-wide parser for classes such as an exceeded context window.
    const shared = parseGoogleErrorMessage(rawMessage).errorType;
    if (shared === AgentRuntimeErrorType.ExceededContextWindow) errorType = shared;
  }

  return new GeminiSpeechError(message, errorType, {
    ...(body?.code !== undefined && { code: body.code }),
    ...(body?.status && { status: body.status }),
    ...(httpStatus !== undefined && { httpStatus }),
  });
};

/**
 * Map the standard TTS payload onto a `generateContent` request. Style instructions go to
 * `speechMetadata.style` on current models and into the prompt on older ones.
 */
export const buildGeminiSpeechRequest = (
  payload: TextToSpeechPayload,
  requestModel: string,
  options?: Pick<TextToSpeechOptions, 'headers' | 'signal'>,
): { format: TTSAudioFormat; request: GenerateContentParameters } => {
  const params = resolveTextToSpeechParams(payload);
  const format = params.format ?? DEFAULT_TTS_AUDIO_FORMAT;

  if (!(GEMINI_TTS_FORMATS as readonly string[]).includes(format)) {
    throw new GeminiSpeechError(
      `Gemini speech does not support the "${format}" format; use one of ${GEMINI_TTS_FORMATS.join(', ')}`,
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  const instructions = params.instructions?.trim();
  let part: Part = { text: payload.input };
  if (instructions) {
    part = isPromptStyledGeminiTTSModel(requestModel)
      ? { text: `${instructions}: ${payload.input}` }
      : { speechMetadata: { style: instructions }, text: payload.input };
  }

  const config: GenerateContentConfig = {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: payload.voice } } },
    ...(options?.signal && { abortSignal: options.signal }),
    ...(options?.headers && { httpOptions: { headers: options.headers } }),
  };

  return {
    format,
    request: { config, contents: [{ parts: [part], role: 'user' }], model: requestModel },
  };
};

/**
 * Collect every audio `inlineData` part of the first candidate. A response without audio
 * is a refusal (safety block) or an upstream failure and must not settle as billable.
 */
export const extractGeminiSpeechAudio = (response: GenerateContentResponse): PcmAudio => {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new GeminiSpeechError(
      `Gemini blocked the speech request (${blockReason})${response.promptFeedback?.blockReasonMessage ? `: ${response.promptFeedback.blockReasonMessage}` : ''}`,
      AgentRuntimeErrorType.ContentModeration,
      { blockReason },
    );
  }

  const candidate = response.candidates?.[0];
  const audioParts =
    candidate?.content?.parts?.filter((part) =>
      part.inlineData?.mimeType?.toLowerCase().startsWith('audio/'),
    ) ?? [];

  if (audioParts.length === 0) {
    const finishReason = candidate?.finishReason;
    const moderated = !!finishReason && MODERATION_REASONS.has(finishReason);

    throw new GeminiSpeechError(
      `Gemini returned no audio${finishReason ? ` (finishReason: ${finishReason})` : ''}${
        candidate?.finishMessage ? `: ${candidate.finishMessage}` : ''
      }`,
      moderated ? AgentRuntimeErrorType.ContentModeration : AgentRuntimeErrorType.ProviderBizError,
      finishReason ? { finishReason } : undefined,
    );
  }

  const decoded = audioParts.map((part) =>
    decodeGeminiAudio(part.inlineData!.data ?? '', part.inlineData!.mimeType),
  );
  const [first] = decoded;
  const mismatched = decoded.some(
    (audio) =>
      audio.sampleRate !== first.sampleRate ||
      audio.channels !== first.channels ||
      audio.bitsPerSample !== first.bitsPerSample,
  );
  if (mismatched) {
    throw new GeminiSpeechError(
      'Gemini returned audio parts with different encodings',
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  const data = Buffer.concat(decoded.map((audio) => audio.data));
  if (data.length === 0) {
    throw new GeminiSpeechError(
      'Gemini returned empty audio',
      AgentRuntimeErrorType.ProviderBizError,
    );
  }

  return { ...first, data };
};

/**
 * Token usage of one synthesis: the prompt is text, the candidates are audio. Audio token
 * details are preferred when Gemini reports them per modality.
 */
export const convertGeminiSpeechTokenUsage = (
  usageMetadata?: GenerateContentResponseUsageMetadata,
) => {
  if (!usageMetadata) return;

  const inputTokens = usageMetadata.promptTokenCount;
  const audioDetail = usageMetadata.candidatesTokensDetails?.find(
    (detail) => detail.modality === 'AUDIO',
  )?.tokenCount;
  const outputTokens = audioDetail ?? usageMetadata.candidatesTokenCount;

  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return;

  return {
    inputTextTokens: inputTokens,
    outputAudioTokens: outputTokens,
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    totalTokens: usageMetadata.totalTokenCount ?? inputTokens + outputTokens,
  };
};

export const encodeGeminiSpeechAudio = async (
  pcm: PcmAudio,
  format: TTSAudioFormat,
): Promise<ArrayBuffer> => {
  switch (format) {
    case 'mp3': {
      return toArrayBuffer(await encodeMp3(pcm));
    }
    case 'wav': {
      return toArrayBuffer(encodeWav(pcm));
    }
    default: {
      return toArrayBuffer(pcm.data);
    }
  }
};

export interface GeminiSpeechOptions extends ModelIdMappingOptions, TextToSpeechOptions {
  /** Provider id used for pricing lookup and error payloads. */
  provider: string;
}

/**
 * Synthesize speech with Gemini's native `generateContent` (`responseModalities: AUDIO`),
 * through the provider's own SDK client so the API key and custom base URL apply.
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */
export async function createGeminiSpeech(
  client: GoogleGenAI,
  payload: TextToSpeechPayload,
  options: GeminiSpeechOptions,
): Promise<TextToSpeechResponse> {
  const { provider } = options;
  const requestModel = resolveMappedModelId(payload.model, options);

  let result: TextToSpeechResponse;
  try {
    const { format, request } = buildGeminiSpeechRequest(payload, requestModel, options);
    const pricing = await getModelPricing(payload.model, provider, options.pricingContext);

    log(
      'generateContent request: model=%s voice=%s format=%s',
      requestModel,
      payload.voice,
      format,
    );

    const response = await client.models.generateContent(request);
    const pcm = extractGeminiSpeechAudio(response);
    const audio = await encodeGeminiSpeechAudio(pcm, format);

    log(
      'generateContent done: %d PCM bytes @ %d Hz -> %d %s bytes, usage=%o',
      pcm.data.length,
      pcm.sampleRate,
      audio.byteLength,
      format,
      response.usageMetadata,
    );

    const usage = convertTextToSpeechUsage(
      payload.input,
      pricing,
      convertGeminiSpeechTokenUsage(response.usageMetadata),
    );

    result = { audio, format, usage };
  } catch (error) {
    log('createGeminiSpeech error: %O', error);

    if ((error as Error)?.name === 'AbortError' || options.signal?.aborted) throw error;

    const speechError = toGeminiSpeechError(error);

    throw AgentRuntimeError.chat({
      error: { message: speechError.message, ...speechError.detail },
      errorType: speechError.errorType,
      provider,
    } satisfies ChatCompletionErrorPayload);
  }

  await options.onUsage?.(result.usage!);

  return result;
}
