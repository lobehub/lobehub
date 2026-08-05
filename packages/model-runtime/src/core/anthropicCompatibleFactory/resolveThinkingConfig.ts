import {
  isAdaptiveThinkingDefaultOnModel,
  isAlwaysThinkingClaudeModel,
  isThinkingDisplayOmittedByDefaultModel,
} from '../../providers/anthropic/modelId';
import type { ChatStreamPayload } from '../../types';

export interface ResolvedClaudeThinkingConfig {
  budget_tokens?: number;
  display?: 'omitted' | 'summarized';
  type: 'adaptive' | 'disabled' | 'enabled';
}

/**
 * Resolve the `thinking` field of a Claude request payload, shared by the Anthropic-compatible
 * factory and Bedrock so both honor the same per-model rules.
 *
 * Two model-specific behaviors drive this:
 *
 * 1. `display` defaults to `omitted` on Claude Fable 5 / Opus 5 / Sonnet 5 / Opus 4.8 / Opus 4.7,
 *    which returns thinking blocks with an empty `thinking` field. We surface reasoning in the UI,
 *    so those models need an explicit `display: 'summarized'`.
 * 2. Models that ship thinking on (Claude 5 and later) keep thinking — and keep billing for it —
 *    even when the request carries no `thinking` config, so leaving it out is not "no thinking",
 *    it is "thinking the user never gets to see".
 *
 * Returns `undefined` when the request should carry no `thinking` field at all.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/thinking#controlling-thinking-display
 * @see https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting#supported-models
 */
export const resolveClaudeThinkingConfig = ({
  maxTokens,
  model,
  thinking,
}: {
  maxTokens: number;
  model: string;
  thinking?: ChatStreamPayload['thinking'];
}): ResolvedClaudeThinkingConfig | undefined => {
  // An explicit `display` from the caller always wins; the model default only fills the gap.
  const displayConfig = thinking?.display
    ? { display: thinking.display }
    : isThinkingDisplayOmittedByDefaultModel(model)
      ? { display: 'summarized' as const }
      : {};

  switch (thinking?.type) {
    case 'enabled': {
      return {
        budget_tokens: Math.min(thinking.budget_tokens || 1024, maxTokens - 1),
        type: 'enabled',
        ...displayConfig,
      };
    }

    case 'adaptive': {
      return { type: 'adaptive', ...displayConfig };
    }

    case 'disabled': {
      // Fable 5 / Mythos 5 reject `disabled` with a 400. Omitting the config is the documented
      // fallback: they think regardless, and their `omitted` display default already keeps the
      // reasoning text out of the response, which is what turning the switch off asks for.
      if (isAlwaysThinkingClaudeModel(model)) return undefined;

      // `display` is invalid alongside `disabled` — there is nothing to display — so any caller
      // value is dropped here rather than forwarded.
      // Models that default thinking off need no explicit opt-out.
      return isAdaptiveThinkingDefaultOnModel(model) ? { type: 'disabled' } : undefined;
    }

    default: {
      return isAdaptiveThinkingDefaultOnModel(model)
        ? { type: 'adaptive', ...displayConfig }
        : undefined;
    }
  }
};
