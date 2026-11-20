import type { ModelTokensUsage, ModelUsage } from '@lobechat/types';
import debug from 'debug';
import type { Pricing } from 'model-bank';

import { withUsageCost } from './utils/withUsageCost';

const log = debug('lobe-cost:convertTextToSpeechUsage');

/**
 * Characters billed for a TTS input. Counts Unicode code points, so a CJK character or
 * an emoji is one character, matching how OpenAI meters `millionCharacters` models.
 */
export const countTextToSpeechCharacters = (input: string) => [...input].length;

const HAN_PATTERN = /\p{Script=Han}/u;

/**
 * Billed characters of a MiniMax speech model: a Chinese character counts as 2, every
 * other character (letters, punctuation, spaces, emoji) as 1. Gateways that resell these
 * models (e.g. OpenRouter `minimax/speech-2.8-hd`) bill the same count.
 * @see https://platform.minimaxi.com/docs/guides/pricing-paygo
 */
export const countMiniMaxSpeechCharacters = (input: string) =>
  [...input].reduce((count, char) => count + (HAN_PATTERN.test(char) ? 2 : 1), 0);

const MINIMAX_SPEECH_MODEL_PATTERN = /^(?:minimax\/)?speech-/i;

/**
 * Whether a model id names a MiniMax speech model, either the catalog id
 * (`speech-2.8-hd`) or a gateway id (`minimax/speech-2.8-hd`).
 */
export const isMiniMaxSpeechModel = (model?: string) =>
  !!model && MINIMAX_SPEECH_MODEL_PATTERN.test(model);

/**
 * Fish Audio bills per million UTF-8 bytes, so a Han character costs three times a Latin
 * letter. Gateways that resell these models (e.g. OpenRouter `fish-audio/s2.1-pro`) bill the
 * same count. Reported as `inputCharacters` against the per-byte price on the model card.
 * @see https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits
 */
export const countFishAudioBilledBytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * Fish Audio speech models: the catalog ids of the `fishaudio` provider (`s2.1-pro`,
 * `drama-3`, ...) and their gateway ids (`fish-audio/s2.1-pro`).
 */
const FISH_AUDIO_SPEECH_MODEL_PATTERN =
  /^(?:fish-audio\/)?(?:s1|s2-pro|s2\.1-pro(?:-free)?|drama-3)$/i;

/** Whether a model id names a Fish Audio speech model, by catalog or gateway id. */
export const isFishAudioSpeechModel = (model?: string) =>
  !!model && FISH_AUDIO_SPEECH_MODEL_PATTERN.test(model);

const FISH_AUDIO_GATEWAY_PREFIX = /^fish-audio\//i;

/**
 * Whether a request on a generic (OpenAI-compatible) runtime goes to Fish Audio. Only a
 * gateway id (`fish-audio/s1`) proves it: a bare id such as `s1` may be any custom
 * provider's own model, so it counts only on the Fish Audio provider itself.
 */
export const isFishAudioSpeechRoute = (
  provider: string | undefined,
  ...models: (string | undefined)[]
) =>
  models.some(
    (model) =>
      isFishAudioSpeechModel(model) &&
      (FISH_AUDIO_GATEWAY_PREFIX.test(model!) || provider === 'fishaudio'),
  );

/** The Fish Audio catalog id of a model id, without the gateway prefix. */
export const toFishAudioCatalogModel = (model: string) =>
  model.replace(FISH_AUDIO_GATEWAY_PREFIX, '');

/**
 * Whether the model is billed per token (e.g. `gpt-4o-mini-tts`) rather than per input
 * character (e.g. `tts-1`). Token-billed models need provider-reported token usage.
 */
export const isTokenBilledTextToSpeech = (pricing?: Pricing) =>
  !!pricing?.units.some((unit) => unit.unit === 'millionTokens');

/**
 * Build the usage of one synthesis. `inputCharacters` is always reported, counted locally
 * unless the provider reports its own billed count; provider token usage is merged in when
 * available. Cost follows the same `computeChatCost` rules as chat: `millionCharacters`
 * units bill `inputCharacters`, `millionTokens` units bill tokens.
 */
export const convertTextToSpeechUsage = (
  input: string,
  pricing?: Pricing,
  tokenUsage?: ModelTokensUsage,
): ModelUsage => {
  const data: ModelTokensUsage = {
    inputCharacters: countTextToSpeechCharacters(input),
    ...tokenUsage,
  };

  log('convertTextToSpeechUsage data: %O', data);

  // Without provider token counts a token-billed model would price to 0; leave `cost`
  // unset so billing consumers settle from their own estimate instead.
  if (isTokenBilledTextToSpeech(pricing) && !tokenUsage) return data;

  return withUsageCost(data, pricing);
};

/**
 * `usage` of the `speech.audio.done` SSE event of `POST /audio/speech`. Input tokens are
 * the text prompt (input + instructions); output tokens are the generated audio.
 */
interface OpenAISpeechTokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export const convertOpenAISpeechTokenUsage = (usage: unknown): ModelTokensUsage | undefined => {
  if (!usage || typeof usage !== 'object') return;

  const { input_tokens, output_tokens, total_tokens } = usage as OpenAISpeechTokenUsage;
  if (typeof input_tokens !== 'number' || typeof output_tokens !== 'number') return;

  return {
    inputTextTokens: input_tokens,
    outputAudioTokens: output_tokens,
    totalInputTokens: input_tokens,
    totalOutputTokens: output_tokens,
    totalTokens: total_tokens ?? input_tokens + output_tokens,
  };
};
