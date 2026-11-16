import type { ModelRuntime } from '@lobechat/model-runtime';
import { countTextToSpeechCharacters } from '@lobechat/model-runtime';
import type { ModelUsage } from '@lobechat/types';
import { AgentRuntimeErrorType, RequestTrigger } from '@lobechat/types';
import type { AITTSModelCard, TTSAudioFormat } from 'model-bank';
import { LOBE_DEFAULT_MODEL_LIST, TTS_AUDIO_MIME_TYPES, validateTTSParams } from 'model-bank';
import { ModelProvider } from 'model-bank/modelProvider';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import { AiModelModel } from '@/database/models/aiModel';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

/**
 * The audio goes back inside one buffered response (≈4.5MB on serverless deploys), as
 * base64 over tRPC or as the raw body over the public API. Uncompressed `wav` / `pcm`
 * (and lossless `flac`) outgrow that within about a minute of speech, after the provider
 * has already billed the synthesis, so only compressed formats are offered.
 */
export const INLINE_TTS_AUDIO_FORMATS = ['mp3', 'opus', 'aac'] as const;

/**
 * Input cap for providers whose models accept far more text than fits in one inline
 * response. Audio comes back in a single base64 body, so a long ElevenLabs Flash request
 * (up to 40,000 characters), or a Fish Audio / Doubao Speech request with no documented
 * limit, would exceed the serverless response limit only after the synthesis was billed.
 * Matches the OpenAPI `/audio/speech` input limit.
 */
export const INLINE_TTS_MAX_INPUT_CHARACTERS = 4096;

const INLINE_INPUT_CAPPED_PROVIDERS = new Set<string>([
  ModelProvider.DoubaoSpeech,
  ModelProvider.ElevenLabs,
  ModelProvider.FishAudio,
]);

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

const providerDisplayName = (provider: string): string =>
  DEFAULT_MODEL_PROVIDER_LIST.find((card) => card.id === provider)?.name ?? provider;

/**
 * The app's own `InvalidProviderAPIKey` copy, plus where to set the key. Server code renders
 * source English, so this is the `modelRuntime.InvalidProviderAPIKey` source string (shown in
 * chat and the provider checker); a test keeps the two in sync.
 */
export const invalidProviderAPIKeyMessage = (provider: string, upstreamMessage?: string) => {
  const name = providerDisplayName(provider);
  const copy = `${name} API Key is incorrect or empty, please check your ${name} API Key and try again`;
  const hint = `Set it in Settings → AI Providers → ${name}, or in the server environment.`;

  return upstreamMessage ? `${copy} (${upstreamMessage}). ${hint}` : `${copy}. ${hint}`;
};

const toProviderError = (error: unknown, provider: string): TTSProviderError => {
  if (!isRecord(error)) return new TTSProviderError(String(error), undefined, error);

  const errorType = typeof error.errorType === 'string' ? error.errorType : undefined;
  const detail = isRecord(error.error) ? error.error : undefined;
  const upstreamMessage =
    (typeof error.message === 'string' && error.message) ||
    (typeof detail?.message === 'string' && detail.message) ||
    (typeof detail?.base_resp?.status_msg === 'string' && detail.base_resp.status_msg) ||
    undefined;

  // A missing or rejected key reads the same as everywhere else in the app, so the
  // caller knows to configure the key rather than retry.
  if (errorType === AgentRuntimeErrorType.InvalidProviderAPIKey) {
    return new TTSProviderError(
      invalidProviderAPIKeyMessage(provider, upstreamMessage),
      errorType,
      error,
    );
  }

  const message =
    upstreamMessage ||
    (errorType ? `${provider} text-to-speech failed: ${errorType}` : '') ||
    `${provider} text-to-speech failed`;

  return new TTSProviderError(message, errorType, error);
};

const KNOWN_PROVIDERS = new Set<string>(Object.values(ModelProvider));

/**
 * Built-in card of a TTS model: the provider's own card first, then, for a built-in provider
 * only, any provider serving the same model id (aggregators reuse upstream cards).
 */
export const findTTSModelCard = (
  provider: string,
  model: string,
): (AITTSModelCard & { providerId?: string }) | undefined => {
  const cards = LOBE_DEFAULT_MODEL_LIST.filter((card) => card.type === 'tts' && card.id === model);
  const own = cards.find((card) => card.providerId === provider);
  if (own) return own as AITTSModelCard & { providerId?: string };

  // A built-in provider (e.g. the LobeHub provider) serves vendor models under their own ids,
  // so it borrows the vendor card. A user-created custom provider's `s1` or `tts-1` is its
  // own model and must not inherit another vendor's limits, params or default voice.
  return (KNOWN_PROVIDERS.has(provider) ? cards[0] : undefined) as
    (AITTSModelCard & { providerId?: string }) | undefined;
};

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

    // Capped by the model's vendor, so the LobeHub provider routing an ElevenLabs model is
    // capped too. Counted in Unicode characters, as billing does: an emoji is one, not two.
    const capped =
      INLINE_INPUT_CAPPED_PROVIDERS.has(provider) ||
      (!!card?.providerId && INLINE_INPUT_CAPPED_PROVIDERS.has(card.providerId));
    const inputCharacters = capped ? countTextToSpeechCharacters(input) : 0;
    if (inputCharacters > INLINE_TTS_MAX_INPUT_CHARACTERS) {
      throw new TTSRequestError(
        `input is ${inputCharacters} characters; ${model} speech is limited to ${INLINE_TTS_MAX_INPUT_CHARACTERS} characters per request. Split the text into shorter requests.`,
        'invalid_params',
      );
    }
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

    const savedVoice =
      request.voice === undefined ? await this.findSavedVoice(provider, model, card) : undefined;
    const voice = request.voice ?? savedVoice ?? card?.parameters?.voice?.default ?? 'alloy';

    let runtime: ModelRuntime;
    try {
      runtime = await initModelRuntimeFromDB(this.db, this.userId, provider, this.workspaceId);
    } catch (error) {
      // Runtimes reject a missing key at construction with a plain
      // `{ errorType: 'InvalidProviderAPIKey' }` payload; surface it as a readable provider
      // error instead of a bare 500. Anything else (e.g. a DB failure) propagates as is.
      if (isRecord(error) && typeof error.errorType === 'string' && !(error instanceof Error)) {
        throw toProviderError(error, provider);
      }
      throw error;
    }

    let result: Awaited<ReturnType<typeof runtime.textToSpeech>>;
    try {
      result = await runtime.textToSpeech(
        {
          input,
          model,
          params,
          voice,
          voiceIsDefault: request.voice === undefined && savedVoice === undefined,
        },
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

  /**
   * The default voice the user saved for this model in Settings → AI Providers. A voice that
   * is no longer in the card's catalog (renamed or retired upstream) is ignored, so a stale
   * preference falls back to the card default instead of failing every request. Reading the
   * preference never blocks synthesis.
   */
  private async findSavedVoice(
    provider: string,
    model: string,
    card: AITTSModelCard | undefined,
  ): Promise<string | undefined> {
    try {
      const row = await new AiModelModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findByIdAndProvider(model, provider);
      const saved = row?.settings?.ttsVoice?.trim();
      if (!saved) return undefined;
      if (card?.voices?.length && !card.voices.some((item) => item.id === saved)) return undefined;

      return saved;
    } catch (error) {
      console.error('[TTSService] failed to read the saved default voice:', error);
      return undefined;
    }
  }
}
