import type { ModelTokensUsage } from '@lobechat/types';
import debug from 'debug';
import { DEFAULT_TTS_AUDIO_FORMAT } from 'model-bank';
import type OpenAI from 'openai';
import type { SpeechCreateParams } from 'openai/resources/audio/speech';

import type {
  TextToSpeechOptions,
  TextToSpeechPayload,
  TextToSpeechResponse,
} from '../../types/tts';
import { resolveTextToSpeechParams } from '../../types/tts';
import type { ChatCompletionErrorPayload } from '../../types/type';
import { getModelPricing } from '../../utils/getModelPricing';
import {
  convertOpenAISpeechTokenUsage,
  convertTextToSpeechUsage,
  isTokenBilledTextToSpeech,
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
      tokenUsage = convertOpenAISpeechTokenUsage(event.usage);
    } else if (event.type === 'error' || event.error) {
      throw Object.assign(new Error('Speech stream returned an error event'), {
        error: event.error ?? event,
      });
    }
  }

  // An empty stream must not settle as a successful (billable) synthesis.
  if (chunks.length === 0) throw new Error('Speech stream ended without audio');

  const merged = Buffer.concat(chunks);
  const audio = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);

  return { audio: audio as ArrayBuffer, tokenUsage };
};

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
  const pricing = await getModelPricing(payload.model, context.provider, options?.pricingContext);
  const streamUsage = isTokenBilledTextToSpeech(pricing);

  log(
    'textToSpeech called with input length: %d, voice: %s, format: %s, sse: %s',
    payload.input.length,
    payload.voice,
    format,
    streamUsage,
  );

  const body: SpeechCreateParams = {
    input: payload.input,
    model: context.requestModel,
    response_format: format,
    voice: payload.voice,
    ...(params.speed !== undefined && { speed: params.speed }),
    ...(params.instructions && { instructions: params.instructions }),
    ...(streamUsage && { stream_format: 'sse' as const }),
  };

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

  const usage = convertTextToSpeechUsage(payload.input, pricing, result.tokenUsage);
  await options?.onUsage?.(usage);

  return { audio: result.audio, format, usage };
};
