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
 * sends the effective level — the user's pick, else the resolved default (see
 * `resolveReasoningEffortSettings`) — so the level shown is the level the
 * upstream runs at.
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
   * Level used when the user has not picked one; must be one of `levels`.
   * Declare it only when the upstream documents it. When omitted, the default
   * comes from the same model's card under another provider, else the middle
   * level.
   */
  default?: ReasoningEffortLevel;
  /**
   * Selectable levels, ordered low → high.
   */
  levels: ReasoningEffortLevel[];
}

export const AiModelReasoningEffortSettingsSchema = z
  .object({
    controlsThinking: z.boolean().optional(),
    default: ReasoningEffortLevelSchema.optional(),
    levels: z.array(ReasoningEffortLevelSchema).min(1),
  })
  // The middle-level fallback and the slider read the list as given.
  .refine((value) => sortReasoningEffortLevels(value.levels).join() === value.levels.join(), {
    message: 'levels must be unique and ordered low → high',
    path: ['levels'],
  })
  .refine((value) => value.default === undefined || value.levels.includes(value.default), {
    message: 'default must be one of levels',
    path: ['default'],
  });

/**
 * The middle level of a list (upper middle for an even count): the last
 * fallback when no card of the model declares a default.
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
 * Builds a card declaration from a level list. `default` is set only when given,
 * so an undocumented default still resolves through `resolveReasoningEffortSettings`.
 */
export const createReasoningEffortSettings = (
  levels: readonly ReasoningEffortLevel[],
  options: Partial<Omit<AiModelReasoningEffortSettings, 'levels'>> = {},
): AiModelReasoningEffortSettings => {
  const sorted = sortReasoningEffortLevels(levels);
  return {
    ...(options.controlsThinking ? { controlsThinking: true } : {}),
    ...(options.default ? { default: options.default } : {}),
    levels: sorted,
  };
};

/**
 * A reasoning effort control whose default has been resolved; what the UI shows
 * and the runtime sends.
 */
export type ResolvedReasoningEffortSettings = AiModelReasoningEffortSettings & {
  default: ReasoningEffortLevel;
};

/**
 * Resolves the control a model instance runs with. The own card's control wins,
 * else the same model's control under another provider (aggregators serve
 * models without copying their settings). The default is the own declared one,
 * else the first same-model declared default this control offers, else the
 * middle level. `sameModelSettings` are the same model id's controls under
 * other providers.
 *
 * @example
 * // aihubmix card without a default; anthropic declares high
 * resolveReasoningEffortSettings({ levels: ['low', 'medium', 'high', 'max'] }, [
 *   { default: 'high', levels: ['low', 'medium', 'high', 'max'] },
 * ]); // → default 'high'
 */
export const resolveReasoningEffortSettings = (
  own: AiModelReasoningEffortSettings | undefined,
  sameModelSettings: readonly (AiModelReasoningEffortSettings | undefined)[] = [],
): ResolvedReasoningEffortSettings | undefined => {
  const settings = own ?? sameModelSettings.find(Boolean);
  if (!settings || settings.levels.length === 0) return undefined;

  const inherited = [settings, ...sameModelSettings]
    .map((candidate) => candidate?.default)
    .find((level) => !!level && settings.levels.includes(level));

  return { ...settings, default: inherited ?? getMiddleReasoningEffortLevel(settings.levels) };
};

/**
 * The level a model runs at: the saved pick when the control still offers it,
 * otherwise the resolved default. A pick the control no longer offers (the
 * card's levels changed after it was saved) is not sent.
 */
export const resolveReasoningEffortLevel = (
  settings: ResolvedReasoningEffortSettings,
  picked?: ReasoningEffortLevel | null,
): ReasoningEffortLevel => (picked && settings.levels.includes(picked) ? picked : settings.default);
