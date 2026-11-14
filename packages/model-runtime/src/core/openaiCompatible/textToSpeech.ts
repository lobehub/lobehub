import type { ModelTokensUsage } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import debug from 'debug';
import {
  DEFAULT_TTS_AUDIO_FORMAT,
  FISH_AUDIO_DEFAULT_VOICE_ID,
  FISH_AUDIO_MAX_INPUT_CHARACTERS,
  type TTSParamsIssue,
  validateTTSParams,
} from 'model-bank';
import fishAudioModels from 'model-bank/fishaudio';
import type OpenAI from 'openai';
import type { SpeechCreateParams } from 'openai/resources/audio/speech';

import type {
  TextToSpeechOptions,
  TextToSpeechPayload,
  TextToSpeechResponse,
} from '../../types/tts';
import { resolveTextToSpeechParams } from '../../types/tts';
import type { ChatCompletionErrorPayload } from '../../types/type';
import { AgentRuntimeError } from '../../utils/createError';
import { getModelPricing } from '../../utils/getModelPricing';
import {
  convertOpenAISpeechTokenUsage,
  convertTextToSpeechUsage,
  countFishAudioBilledBytes,
  countMiniMaxSpeechCharacters,
  countTextToSpeechCharacters,
  isFishAudioSpeechModel,
  isFishAudioSpeechRoute,
  isMiniMaxSpeechModel,
  isTokenBilledTextToSpeech,
  toFishAudioCatalogModel,
} from '../usageConverters/tts';

export interface CreateOpenAICompatibleSpeechContext {
  handleError: (error: unknown) => ChatCompletionErrorPayload;
  logPrefix: string;
  provider: string;
  /** Upstream model id after model-id mapping. */
  requestModel: string;
}

interface SpeechEventStreamResult {
  audio: ArrayBuffer;
  tokenUsage?: ModelTokensUsage;
}

const isEventStream = (response: Response) =>
  response.headers.get('content-type')?.includes('text/event-stream') ?? false;

/**
 * Collect `speech.audio.delta` chunks and the `speech.audio.done` usage of an SSE response.
 */
const readSpeechEventStream = async (response: Response): Promise<SpeechEventStreamResult> => {
  const text = await response.text();
  const chunks: Buffer[] = [];
  let tokenUsage: ModelTokensUsage | undefined;
  let completed = false;

  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;

    const data = line.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;

    let event: { audio?: string; error?: unknown; type?: string; usage?: unknown };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }

    if (event.type === 'speech.audio.delta' && event.audio) {
      chunks.push(Buffer.from(event.audio, 'base64'));
    } else if (event.type === 'speech.audio.done') {
      completed = true;
      tokenUsage = convertOpenAISpeechTokenUsage(event.usage);
    } else if (event.type === 'error' || event.error) {
      throw Object.assign(new Error('Speech stream returned an error event'), {
        error: event.error ?? event,
      });
    }
  }

  // An empty or truncated stream must not settle as a successful (billable) synthesis.
  if (chunks.length === 0) throw new Error('Speech stream ended without audio');
  if (!completed) throw new Error('Speech stream ended before speech.audio.done');

  const merged = Buffer.concat(chunks);
  const audio = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);

  return { audio: audio as ArrayBuffer, tokenUsage };
};

/**
 * Text a gateway bills for a Fish Audio model: OpenRouter writes `instructions` into the
 * input as a leading `[direction]`, the way Fish takes delivery directions, and bills it.
 * @see https://openrouter.ai/docs/guides/overview/multimodal/tts
 */
const fishAudioBilledText = (input: string, params: { instructions?: string }) =>
  params.instructions ? `[${params.instructions}] ${input}` : input;

/**
 * `POST /audio/speech` with the standard TTS params. Token-billed models (e.g.
 * `gpt-4o-mini-tts`) are requested as SSE because only the `speech.audio.done` event
 * reports token usage; character-billed models (`tts-1`) return the raw audio body.
 */
export const createOpenAICompatibleSpeech = async (
  client: OpenAI,
  payload: TextToSpeechPayload,
  options: TextToSpeechOptions | undefined,
  context: CreateOpenAICompatibleSpeechContext,
): Promise<TextToSpeechResponse> => {
  const log = debug(`${context.logPrefix}:textToSpeech`);
  const params = resolveTextToSpeechParams(payload);
  const format = params.format ?? DEFAULT_TTS_AUDIO_FORMAT;
  const fishAudio = isFishAudioSpeechRoute(context.provider, payload.model, context.requestModel);
  // A gateway id (`fish-audio/s2.1-pro` on OpenRouter) or an alias mapped to one has no
  // card of its own: price it by the Fish Audio catalog card of the model actually called,
  // preferring the mapped upstream id over the logical alias.
  const fishCatalogModel = fishAudio
    ? [context.requestModel, payload.model].find((model) => isFishAudioSpeechModel(model))
    : undefined;
  const pricing =
    (await getModelPricing(payload.model, context.provider, options?.pricingContext)) ??
    (fishCatalogModel
      ? await getModelPricing(
          toFishAudioCatalogModel(fishCatalogModel),
          'fishaudio',
          options?.pricingContext,
        )
      : undefined);
  const streamUsage = isTokenBilledTextToSpeech(pricing);

  // Fish Audio returns the whole audio inline; a longer input would be billed and then
  // exceed the serverless response limit. Gateway ids (`fish-audio/s2.1-pro`) match no
  // static card, so the TTS service cannot cap them and the cap is enforced here.
  if (fishAudio) {
    const inputCharacters = countTextToSpeechCharacters(payload.input);
    if (inputCharacters > FISH_AUDIO_MAX_INPUT_CHARACTERS) {
      throw AgentRuntimeError.chat({
        error: {
          message: `Fish Audio speech input is ${inputCharacters} characters; the limit is ${FISH_AUDIO_MAX_INPUT_CHARACTERS} per request. Split the text into shorter requests.`,
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: context.provider,
      });
    }

    // The TTS service validates params against the static card, which a gateway or mapped
    // id never matches; check them against the Fish catalog card of the model actually
    // called, so e.g. S1 refuses `instructions` it would otherwise speak aloud.
    // `s2.1-pro-free` has no card of its own and follows the S2.1 Pro schema.
    const catalogId = fishCatalogModel ? toFishAudioCatalogModel(fishCatalogModel) : undefined;
    const card = catalogId
      ? (fishAudioModels.find((item) => item.id === catalogId) ??
        fishAudioModels.find((item) => item.id === catalogId.replace(/-free$/, '')))
      : undefined;
    const issues: TTSParamsIssue[] = card?.parameters
      ? validateTTSParams(card.parameters, params)
      : [];
    // `/audio/speech` has no sample-rate field, so a gateway could only drop it silently.
    if (params.sampleRate !== undefined) {
      issues.push({
        key: 'sampleRate',
        reason: 'is not supported through an OpenAI-compatible gateway; omit it',
      });
    }
    if (issues.length > 0) {
      throw AgentRuntimeError.chat({
        error: {
          message: `Fish Audio ${catalogId ?? payload.model}: ${issues.map(({ key, reason }) => `params.${key} ${reason}`).join('; ')}`,
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        provider: context.provider,
      });
    }
  }
  // Fish Audio's default voice is "no reference voice": gateways (OpenRouter) reject the
  // `default` sentinel with 400 but speak the default voice when `voice` is left out. A
  // service fallback voice (`voiceIsDefault`, e.g. `alloy` for a gateway id with no card)
  // means the caller gave none, so it is left out too.
  const omitVoice =
    fishAudio &&
    (!payload.voice || payload.voice === FISH_AUDIO_DEFAULT_VOICE_ID || !!payload.voiceIsDefault);

  log(
    'textToSpeech called with input length: %d, voice: %s, format: %s, sse: %s',
    payload.input.length,
    payload.voice,
    format,
    streamUsage,
  );

  const body = {
    input: payload.input,
    model: context.requestModel,
    response_format: format,
    ...(!omitVoice && { voice: payload.voice }),
    ...(params.speed !== undefined && { speed: params.speed }),
    ...(params.instructions && { instructions: params.instructions }),
    ...(streamUsage && { stream_format: 'sse' as const }),
  } as SpeechCreateParams;

  let result: SpeechEventStreamResult;
  try {
    const response = await client.audio.speech.create(body, {
      headers: options?.headers,
      signal: options?.signal,
    });

    // OpenAI-compatible gateways may ignore `stream_format` and answer with raw audio.
    result = isEventStream(response)
      ? await readSpeechEventStream(response)
      : { audio: await response.arrayBuffer() };
  } catch (error) {
    throw context.handleError(error);
  }

  log('generated audio with size: %d bytes', result.audio.byteLength);

  // Gateways bill by the vendor's own count: MiniMax counts a Chinese character as 2,
  // Fish Audio counts UTF-8 bytes (a Chinese character is 3).
  const billedCharacters = streamUsage
    ? undefined
    : fishAudio
      ? { inputCharacters: countFishAudioBilledBytes(fishAudioBilledText(payload.input, params)) }
      : isMiniMaxSpeechModel(payload.model) || isMiniMaxSpeechModel(context.requestModel)
        ? { inputCharacters: countMiniMaxSpeechCharacters(payload.input) }
        : undefined;
  const usage = convertTextToSpeechUsage(
    payload.input,
    pricing,
    billedCharacters ? { ...billedCharacters, ...result.tokenUsage } : result.tokenUsage,
  );
  await options?.onUsage?.(usage);

  return { audio: result.audio, format, usage };
};
