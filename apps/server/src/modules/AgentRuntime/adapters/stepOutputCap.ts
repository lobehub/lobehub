import type { ModelCardFacts } from '@lobechat/types';

/**
 * Default output budget of one server-runtime LLM step.
 *
 * Without an explicit `max_tokens`, providers fall back to the model's full
 * output window, 128k tokens for the current Claude models. At ~100 tok/s that
 * is ~1300s, close to the whole step invocation budget, so one long step can
 * outlive the invocation and be stopped mid-stream with nothing to show for
 * the full upstream output. 64k leaves room for long answers and ends within
 * ~640s.
 *
 * Best effort: a provider that manages the output length itself drops the
 * value (the ChatGPT subscription backend rejects `max_output_tokens`), and
 * the invocation deadline stop still bounds such a step.
 */
export const STEP_MAX_OUTPUT_TOKENS = 64_000;

interface ResolveStepMaxTokensInput {
  /** Frozen model cards of the run: the provider's own card, then the canonical one. */
  cards?: ModelCardFacts[];
  model: string;
  provider: string;
  /** `max_tokens` the agent configured (only set when the user enabled the limit). */
  requested?: number;
}

/**
 * The `max_tokens` a step should send when the agent sets none, or `undefined`
 * to leave the request unchanged.
 *
 * Only models declaring more than {@link STEP_MAX_OUTPUT_TOKENS} are capped: a
 * model with a smaller window keeps the provider default, so no request starts
 * sending a value its provider might reject. An explicit user limit wins.
 */
export const resolveStepMaxTokens = ({
  cards,
  model,
  provider,
  requested,
}: ResolveStepMaxTokensInput): number | undefined => {
  if (typeof requested === 'number') return undefined;

  const matches = (card: ModelCardFacts) => card.id === model || card.deploymentName === model;
  // The LobeHub provider's own card may omit the window; the canonical card of
  // the same model id still declares it.
  const maxOutput =
    cards?.find((card) => card.providerId === provider && matches(card))?.maxOutput ??
    cards?.find((card) => matches(card) && card.maxOutput)?.maxOutput;

  if (!maxOutput || maxOutput <= STEP_MAX_OUTPUT_TOKENS) return undefined;
  return STEP_MAX_OUTPUT_TOKENS;
};
