/**
 * Provider-reported input tokens divided by `estimateTextTokens` of the same text-only
 * request, by model family. Measured on 2026-11-28 over four days of text-only agent requests:
 * Claude ran 1.27–1.50 (median by channel); GPT, Gemini, DeepSeek, Qwen, Kimi, MiniMax and Grok
 * ran 0.82–1.0, close enough that they keep the raw estimate.
 */
export const FAMILY_INPUT_TOKEN_RATIOS: Readonly<Record<string, number>> = {
  claude: 1.35,
};

/** An anchor ratio outside this range points at a bad record, not tokenizer drift. */
const MIN_ANCHOR_RATIO = 0.5;
const MAX_ANCHOR_RATIO = 3;
/** Below this, fixed per-request overhead dominates the ratio. */
const MIN_ANCHOR_ESTIMATED_TOKENS = 1000;

export interface InputTokenRatioAnchor {
  /** Provider-reported input tokens of that request. */
  actualTokens?: number;
  /** Estimated text tokens of that request. */
  estimatedTokens: number;
  /**
   * Media items the request carried. The estimate leaves media out while provider usage bills
   * it, so only a request known to carry none can anchor. Absent means unknown.
   */
  media?: { audio: number; image: number; video: number };
}

export interface ResolveInputTokenRatioParams {
  /**
   * The latest recorded request to the same model and provider. Its own ratio covers what a
   * family default cannot: the provider's tokenizer, a relay's injected prompt, and the
   * conversation's mix of code, CJK and JSON.
   */
  anchor?: InputTokenRatioAnchor;
  /** Model card `family`, e.g. `claude-sonnet`. */
  family?: string;
  /** Model id, matched when the card has no family (custom providers). */
  model?: string;
}

export interface InputTokenRatio {
  ratio: number;
  source: 'anchor' | 'family' | 'none';
}

const readAnchorRatio = (anchor: InputTokenRatioAnchor | undefined): number | undefined => {
  if (!anchor?.actualTokens || anchor.estimatedTokens < MIN_ANCHOR_ESTIMATED_TOKENS) return;

  const { media } = anchor;
  if (!media || media.audio + media.image + media.video > 0) return;

  const ratio = anchor.actualTokens / anchor.estimatedTokens;
  if (!Number.isFinite(ratio) || ratio < MIN_ANCHOR_RATIO || ratio > MAX_ANCHOR_RATIO) return;

  return ratio;
};

const readFamilyRatio = (family: string | undefined, model: string | undefined) => {
  const names = [family, model].filter(Boolean).map((name) => name!.toLowerCase());

  for (const [key, ratio] of Object.entries(FAMILY_INPUT_TOKEN_RATIOS)) {
    if (names.some((name) => name.includes(key))) return ratio;
  }
};

/**
 * Multiplier from `estimateTextTokens` counts to the model's own tokens.
 *
 * Use when:
 * - Showing an estimate as the model's tokens (context usage, cost hints).
 *
 * Expects:
 * - The multiplied counts are estimates. Provider-reported counts (recorded output usage) are
 *   already in the model's tokens and must not be multiplied.
 *
 * Returns:
 * - The anchor request's own ratio when it is usable, else the family default, else 1.
 */
export const resolveInputTokenRatio = ({
  anchor,
  family,
  model,
}: ResolveInputTokenRatioParams): InputTokenRatio => {
  const anchorRatio = readAnchorRatio(anchor);
  if (anchorRatio !== undefined) return { ratio: anchorRatio, source: 'anchor' };

  const familyRatio = readFamilyRatio(family, model);
  if (familyRatio !== undefined) return { ratio: familyRatio, source: 'family' };

  return { ratio: 1, source: 'none' };
};
