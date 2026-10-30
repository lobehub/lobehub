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

/**
 * Whether the model is billed per token (e.g. `gpt-4o-mini-tts`) rather than per input
 * character (e.g. `tts-1`). Token-billed models need provider-reported token usage.
 */
export const isTokenBilledTextToSpeech = (pricing?: Pricing) =>
  !!pricing?.units.some((unit) => unit.unit === 'millionTokens');

/**
 * Build the usage of one synthesis. `inputCharacters` is always reported; provider token
 * usage is merged in when available. Cost follows the same `computeChatCost` rules as
 * chat: `millionCharacters` units bill `inputCharacters`, `millionTokens` units bill tokens.
 */
export const convertTextToSpeechUsage = (
  input: string,
  pricing?: Pricing,
  tokenUsage?: ModelTokensUsage,
): ModelUsage => {
  const data: ModelTokensUsage = {
    ...tokenUsage,
    inputCharacters: countTextToSpeechCharacters(input),
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
