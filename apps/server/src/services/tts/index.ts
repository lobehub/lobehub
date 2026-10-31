import type { ModelUsage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import type { AITTSModelCard, TTSAudioFormat } from 'model-bank';
import { LOBE_DEFAULT_MODEL_LIST, TTS_AUDIO_MIME_TYPES, validateTTSParams } from 'model-bank';
import { ModelProvider } from 'model-bank/modelProvider';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

/**
 * The audio goes back inside one buffered response (≈4.5MB on serverless deploys), as
 * base64 over tRPC or as the raw body over the public API. Uncompressed `wav` / `pcm`
 * (and lossless `flac`) outgrow that within about a minute of speech, after the provider
 * has already billed the synthesis, so only compressed formats are offered.
 */
export const INLINE_TTS_AUDIO_FORMATS = ['mp3', 'opus', 'aac'] as const;

export interface TTSSynthesizeParams {
  emotion?: string;
  format?: (typeof INLINE_TTS_AUDIO_FORMATS)[number];
  instructions?: string;
  pitch?: number;
  sampleRate?: number;
  speed?: number;
  volume?: number;
}

export interface TTSSynthesizeRequest {
  input: string;
  model: string;
  params?: TTSSynthesizeParams;
  provider: string;
  /** @deprecated Top-level speed sent by older CLIs; `params.speed` wins. */
  speed?: number;
  /** Defaults to the model card's default voice. */
  voice?: string;
}

export interface TTSSynthesizeResult {
  audio: ArrayBuffer;
  format: TTSAudioFormat;
  mimeType: string;
  usage?: ModelUsage;
}

/** The request itself is invalid: a bad parameter, or a provider without TTS. */
export class TTSRequestError extends Error {
  readonly name = 'TTSRequestError';

  constructor(
    message: string,
    readonly reason: 'invalid_params' | 'unsupported_provider',
  ) {
    super(message);
  }
}

/**
 * The provider refused or failed the synthesis. Runtimes reject with plain
 * `{ errorType, error }` payloads as well as `Error`s; this carries a readable
 * message for both, so callers never surface an empty 500.
 */
export class TTSProviderError extends Error {
  readonly name = 'TTSProviderError';

  constructor(
    message: string,
    readonly errorType: string | undefined,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null;

const toProviderError = (error: unknown, provider: string): TTSProviderError => {
  if (!isRecord(error)) return new TTSProviderError(String(error), undefined, error);

  const errorType = typeof error.errorType === 'string' ? error.errorType : undefined;
  const detail = isRecord(error.error) ? error.error : undefined;
  const message =
    (typeof error.message === 'string' && error.message) ||
    (typeof detail?.message === 'string' && detail.message) ||
    (typeof detail?.base_resp?.status_msg === 'string' && detail.base_resp.status_msg) ||
    (errorType ? `${provider} text-to-speech failed: ${errorType}` : '') ||
    `${provider} text-to-speech failed`;

  return new TTSProviderError(message, errorType, error);
};

/**
 * Built-in card of a TTS model: the provider's own card first, then any provider
 * serving the same model id (aggregators reuse upstream cards).
 */
export const findTTSModelCard = (provider: string, model: string): AITTSModelCard | undefined => {
  const cards = LOBE_DEFAULT_MODEL_LIST.filter((card) => card.type === 'tts' && card.id === model);

  return (cards.find((card) => card.providerId === provider) ?? cards[0]) as
    AITTSModelCard | undefined;
};

const KNOWN_PROVIDERS = new Set<string>(Object.values(ModelProvider));

/**
 * Splits a public-API model reference into provider and model. An explicit provider wins;
 * otherwise a leading known provider id (`lobehub/speech-2.8-hd`) is taken as the provider,
 * so model ids that contain a slash themselves (`FunAudioLLM/CosyVoice2-0.5B`) stay whole.
 * A bare id falls back to the provider of its built-in card, then to OpenAI.
 */
export const resolveTTSModelRef = (
  modelRef: string,
  provider?: string,
): { model: string; provider: string } => {
  if (provider) return { model: modelRef, provider };

  const slash = modelRef.indexOf('/');
  if (slash > 0 && KNOWN_PROVIDERS.has(modelRef.slice(0, slash))) {
    return { model: modelRef.slice(slash + 1), provider: modelRef.slice(0, slash) };
  }

  const card = LOBE_DEFAULT_MODEL_LIST.find((item) => item.type === 'tts' && item.id === modelRef);
  return { model: modelRef, provider: card?.providerId ?? ModelProvider.OpenAI };
};

/**
 * Text-to-speech shared by the tRPC router and the public OpenAPI route: validates the
 * params against the model card, then synthesizes through the user's model runtime, whose
 * hooks reserve, settle and release the spend.
 */
export class TTSService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  async synthesize(request: TTSSynthesizeRequest): Promise<TTSSynthesizeResult> {
    const { input, model, provider } = request;
    const card = findTTSModelCard(provider, model);
    const params: TTSSynthesizeParams = { ...request.params };
    // Older CLIs always send the deprecated top-level `speed`; drop it for models that
    // declare no speed instead of failing validation they never opted into.
    const acceptsLegacySpeed = !card?.parameters || 'speed' in card.parameters;
    if (params.speed === undefined && request.speed !== undefined && acceptsLegacySpeed) {
      params.speed = request.speed;
    }

    if (card?.parameters) {
      const issues = validateTTSParams(card.parameters, params);
      if (issues.length > 0) {
        throw new TTSRequestError(
          issues.map(({ key, reason }) => `params.${key} ${reason}`).join('; '),
          'invalid_params',
        );
      }
    }

    const voice = request.voice ?? card?.parameters?.voice?.default ?? 'alloy';

    const runtime = await initModelRuntimeFromDB(this.db, this.userId, provider, this.workspaceId);

    let result: Awaited<ReturnType<typeof runtime.textToSpeech>>;
    try {
      result = await runtime.textToSpeech(
        { input, model, params, voice },
        { metadata: { trigger: RequestTrigger.Tts }, user: this.userId },
      );
    } catch (error) {
      // Budget refusals and other server-side guards already carry their own status.
      if (error instanceof Error && error.name === 'TRPCError') throw error;
      throw toProviderError(error, provider);
    }

    if (!result) {
      throw new TTSRequestError(
        `Provider "${provider}" does not support text-to-speech.`,
        'unsupported_provider',
      );
    }

    return {
      audio: result.audio,
      format: result.format,
      mimeType: TTS_AUDIO_MIME_TYPES[result.format],
      usage: result.usage,
    };
  }
}
