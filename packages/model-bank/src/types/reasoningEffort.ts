import { z } from 'zod';

/**
 * Every reasoning effort level any model exposes, in canonical low → high order.
 * A model card picks the subset it accepts; the UI and the runtime only ever see
 * values from this list.
 */
export const REASONING_EFFORT_LEVELS = [
  'none',
  'no_think',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number];

export const ReasoningEffortLevelSchema = z.enum(REASONING_EFFORT_LEVELS);

/**
 * A model's reasoning effort control, declared once on its card
 * (`settings.reasoningEffort`). The UI renders `levels`, and the runtime always
 * sends the effective level — the user's pick, else `default` — so the level
 * shown is the level the upstream runs at.
 */
export interface AiModelReasoningEffortSettings {
  /**
   * The effort also switches thinking: `none` sends thinking disabled and no
   * effort; every other level sends thinking enabled with that effort. Used by
   * models whose API couples the two (DeepSeek V4, Qwen 3.8, GLM 5.3 — the last
   * rejects disabled thinking and has no `none` level).
   */
  controlsThinking?: boolean;
  /**
   * Level used when the user has not picked one. Must be one of `levels`.
   */
  default: ReasoningEffortLevel;
  /**
   * Selectable levels, ordered low → high.
   */
  levels: ReasoningEffortLevel[];
}

export const AiModelReasoningEffortSettingsSchema = z
  .object({
    controlsThinking: z.boolean().optional(),
    default: ReasoningEffortLevelSchema,
    levels: z.array(ReasoningEffortLevelSchema).min(1),
  })
  .refine((value) => value.levels.includes(value.default), {
    message: 'default must be one of levels',
    path: ['default'],
  });

/**
 * The middle level of a list (upper middle for an even count), used as the
 * default for models whose upstream default was not researched.
 */
export const getMiddleReasoningEffortLevel = (
  levels: readonly ReasoningEffortLevel[],
): ReasoningEffortLevel => levels[Math.floor(levels.length / 2)];

/**
 * Sorts levels into canonical order and drops duplicates.
 */
export const sortReasoningEffortLevels = (
  levels: readonly ReasoningEffortLevel[],
): ReasoningEffortLevel[] => REASONING_EFFORT_LEVELS.filter((level) => levels.includes(level));

/**
 * Builds a card declaration from a level list, defaulting to its middle level.
 */
export const createReasoningEffortSettings = (
  levels: readonly ReasoningEffortLevel[],
  options: Partial<Omit<AiModelReasoningEffortSettings, 'levels'>> = {},
): AiModelReasoningEffortSettings => {
  const sorted = sortReasoningEffortLevels(levels);
  return {
    ...(options.controlsThinking ? { controlsThinking: true } : {}),
    default: options.default ?? getMiddleReasoningEffortLevel(sorted),
    levels: sorted,
  };
};

/**
 * The level a model runs at: the saved pick when the card still offers it,
 * otherwise the card default. A pick the card no longer offers (the card's
 * levels changed after it was saved) is not sent.
 */
export const resolveReasoningEffortLevel = (
  settings: AiModelReasoningEffortSettings,
  picked?: ReasoningEffortLevel | null,
): ReasoningEffortLevel => (picked && settings.levels.includes(picked) ? picked : settings.default);

/**
 * Saved-value keys of the per-model effort params that `reasoningEffort`
 * replaced (LOBE-14979). Writes that set `reasoningEffort` remove them, so a
 * leftover key is always a pick made by the previous app version and the
 * migration script can still move it without overwriting a newer pick.
 */
export const LEGACY_REASONING_EFFORT_KEYS = [
  'codexMaxReasoningEffort',
  'deepseekV4GAReasoningEffort',
  'deepseekV4ReasoningEffort',
  'effort',
  'glm5_2ReasoningEffort',
  'glm5_3ReasoningEffort',
  'gpt5_1ReasoningEffort',
  'gpt5_2ProReasoningEffort',
  'gpt5_2ReasoningEffort',
  'gpt5_6ReasoningEffort',
  'gpt5ReasoningEffort',
  'gpt6ReasoningEffort',
  'grok4_3ReasoningEffort',
  'grok4_5ReasoningEffort',
  'grok4_6ReasoningEffort',
  'grok4_7ReasoningEffort',
  'grok4_20ReasoningEffort',
  'hy3ReasoningEffort',
  'kimiK3ReasoningEffort',
  'opus47Effort',
  'qwen38ReasoningEffort',
  'ring2_6ReasoningEffort',
  'step3_5ReasoningEffort',
  'thinkingLevel',
  'thinkingLevel2',
  'thinkingLevel3',
  'thinkingLevel4',
] as const;

/**
 * Removes the legacy effort keys from a saved config when a write sets
 * `reasoningEffort`, so the new pick is the only effort value left.
 */
export const stripLegacyEffortKeys = <T extends Record<string, unknown>>(config: T): T => {
  if (config.reasoningEffort === undefined) return config;
  const next: Record<string, unknown> = { ...config };
  for (const key of LEGACY_REASONING_EFFORT_KEYS) delete next[key];
  return next as T;
};
