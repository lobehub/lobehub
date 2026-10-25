import { z } from 'zod';

import { isBotWakeEnabled } from './gate';
import type { BotWakeConfig, WakePolicyMode, WakeRules, WakeSchedulerConfig } from './types';

export const DEFAULT_WAKE_RULES: WakeRules = {
  allowChannels: [],
  classifier: { mode: 'shadow', threshold: 0.5 },
  denyChannels: [],
  maxSilentWakes: 3,
  ownerPresenceSeconds: 120,
  scope: 'all',
  windowSeconds: 300,
};

/** Spec: a burst is collected for at least 20s, and a run is followed by at least 60s of cooldown. */
export const MIN_COLLECT_SECONDS = 20;
export const MIN_COOLDOWN_SECONDS = 60;

export interface ResolvedWakeScheduler {
  collectMs: number;
  cooldownMs: number;
  mode: 'enforce' | 'off';
}

/** Longest custom instruction handed to the classifier; longer text is cut, not rejected. */
export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 1000;

const MAX_CHANNEL_LIST = 200;

// `.catch` on every field: one malformed value in a user-edited JSON blob falls back to its
// default instead of discarding the rest of the owner's rules.
const mode = z.enum(['off', 'shadow', 'enforce']);
const idList = z
  .array(z.union([z.string(), z.number()]).transform(String))
  .max(MAX_CHANNEL_LIST)
  .catch([]);
const seconds = (fallback: number, min = 0) =>
  z.number().finite().min(min).max(86_400).catch(fallback);

const SettingsSchema = z
  .object({
    classifier: z
      .object({
        mode: mode.catch(DEFAULT_WAKE_RULES.classifier.mode),
        threshold: z.number().min(0).max(1).catch(DEFAULT_WAKE_RULES.classifier.threshold),
      })
      .partial()
      .catch({}),
    customInstructions: z.string().catch(''),
    enabled: z.boolean().catch(false),
    mode: mode.catch('shadow'),
    rules: z
      .object({
        allowChannels: idList,
        denyChannels: idList,
        maxSilentWakes: z.number().int().min(0).max(100).catch(DEFAULT_WAKE_RULES.maxSilentWakes),
        ownerPresenceSeconds: seconds(DEFAULT_WAKE_RULES.ownerPresenceSeconds),
        scope: z.enum(['all', 'bot-threads', 'none']).catch(DEFAULT_WAKE_RULES.scope),
        windowSeconds: seconds(DEFAULT_WAKE_RULES.windowSeconds),
      })
      .partial()
      .catch({}),
    scheduler: z
      .object({
        collectSeconds: seconds(MIN_COLLECT_SECONDS),
        cooldownSeconds: seconds(MIN_COOLDOWN_SECONDS),
        mode: z.enum(['enforce', 'off']).catch('off'),
      })
      .partial()
      .catch({}),
  })
  .partial();

export interface ParsedBotWakeSettings {
  config: BotWakeConfig;
  /** Mode of the rule policies (internal rules, owner rules). */
  ruleMode: WakePolicyMode;
  rules: WakeRules;
  scheduler: ResolvedWakeScheduler;
}

/**
 * Parses `settings.botWake` into a config with defaults applied.
 *
 * Use when:
 * - Anything reads the owner's wake rules: the policy set, the scheduler, the gateway mapping
 *
 * Expects:
 * - `settings` is the provider's raw settings object; any shape, including `null`
 *
 * Returns:
 * - Always a usable value. A field that fails validation takes its default; a non-object
 *   `botWake` yields a disabled config.
 */
export const parseBotWakeSettings = (
  settings: Record<string, unknown> | null | undefined,
): ParsedBotWakeSettings => {
  const parsed = SettingsSchema.safeParse(
    settings && typeof settings.botWake === 'object' && settings.botWake !== null
      ? settings.botWake
      : {},
  );
  const raw = parsed.success ? parsed.data : {};

  const rules: WakeRules = {
    ...DEFAULT_WAKE_RULES,
    ...raw.rules,
    classifier: { ...DEFAULT_WAKE_RULES.classifier, ...raw.classifier },
    customInstructions:
      raw.customInstructions?.trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH) || undefined,
  };

  const schedulerRaw: WakeSchedulerConfig = raw.scheduler ?? {};

  return {
    config: { ...raw, rules },
    rules,
    ruleMode: raw.mode ?? 'shadow',
    scheduler: {
      collectMs: Math.max(MIN_COLLECT_SECONDS, schedulerRaw.collectSeconds ?? 0) * 1000,
      cooldownMs: Math.max(MIN_COOLDOWN_SECONDS, schedulerRaw.cooldownSeconds ?? 0) * 1000,
      mode: schedulerRaw.mode ?? 'off',
    },
  };
};

/**
 * Whether the bot has any rule that listens to messages nobody addressed to it: a watch
 * keyword, or an enabled bot-wake scenario. The gateway forwards channel traffic to the server
 * only when this is true, so a rule the owner configured but the gateway never forwards for
 * would never fire.
 */
export const hasPassiveListeningRule = (
  settings: Record<string, unknown> | null | undefined,
  watchKeywordCount: number,
): boolean => {
  if (watchKeywordCount > 0) return true;

  const { config, rules } = parseBotWakeSettings(settings);

  return isBotWakeEnabled(config) && rules.scope !== 'none';
};
