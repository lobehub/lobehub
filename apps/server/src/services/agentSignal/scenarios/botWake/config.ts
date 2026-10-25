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

/**
 * Hard cap on the bot-wake channel lists. The parser rejects an over-cap list wholesale and
 * falls back to `[]`, so an over-cap allowlist stops restricting anything. The settings form
 * reads the same number to stop an owner from building one (see `botWakeFields`).
 */
export const MAX_BOT_WAKE_CHANNEL_LIST = 200;

// `.catch` on every field: one malformed value in a user-edited JSON blob falls back to its
// default instead of discarding the rest of the owner's rules.
const mode = z.enum(['off', 'shadow', 'enforce']);
// The settings form stores a list of ids as rows (`[{ id }]`); a hand-written config may use bare ids.
const idList = z
  .array(
    z
      .union([z.string(), z.number(), z.object({ id: z.union([z.string(), z.number()]) })])
      .transform((value) => String(typeof value === 'object' ? value.id : value).trim()),
  )
  .max(MAX_BOT_WAKE_CHANNEL_LIST)
  .transform((ids) => ids.filter(Boolean))
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

/**
 * The provider setting keys the channel settings form writes. The form renders every field of the
 * `settings` group flat, so the bot-wake options are flat keys there rather than one nested
 * object.
 */
export const BOT_WAKE_SETTING_KEYS = {
  allowChannels: 'botWakeAllowChannels',
  classifierMode: 'botWakeClassifierMode',
  classifierThreshold: 'botWakeClassifierThreshold',
  collectSeconds: 'botWakeCollectSeconds',
  cooldownSeconds: 'botWakeCooldownSeconds',
  customInstructions: 'botWakeCustomInstructions',
  denyChannels: 'botWakeDenyChannels',
  enabled: 'botWakeEnabled',
  maxSilentWakes: 'botWakeMaxSilentWakes',
  mode: 'botWakeMode',
  ownerPresenceSeconds: 'botWakeOwnerPresenceSeconds',
  schedulerMode: 'botWakeSchedulerMode',
  scope: 'botWakeScope',
  windowSeconds: 'botWakeWindowSeconds',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A form leaves an untouched field `undefined`, `null` or an empty string; none of them is a choice. */
const isChosen = (value: unknown) => value !== undefined && value !== null && value !== '';

const chosen = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => isChosen(value)));

/**
 * How a nested `settings.botWake` object maps onto the flat keys the settings form writes.
 *
 * Kept next to `BOT_WAKE_SETTING_KEYS` so a new option cannot be added to one without the other:
 * `flattenBotWakeSettings` is what carries a hand-written config into the form.
 */
const BOT_WAKE_NESTED_PATHS: Array<{ key: string; path: string[] }> = [
  { key: BOT_WAKE_SETTING_KEYS.enabled, path: ['enabled'] },
  { key: BOT_WAKE_SETTING_KEYS.mode, path: ['mode'] },
  { key: BOT_WAKE_SETTING_KEYS.customInstructions, path: ['customInstructions'] },
  { key: BOT_WAKE_SETTING_KEYS.classifierMode, path: ['classifier', 'mode'] },
  { key: BOT_WAKE_SETTING_KEYS.classifierThreshold, path: ['classifier', 'threshold'] },
  { key: BOT_WAKE_SETTING_KEYS.allowChannels, path: ['rules', 'allowChannels'] },
  { key: BOT_WAKE_SETTING_KEYS.denyChannels, path: ['rules', 'denyChannels'] },
  { key: BOT_WAKE_SETTING_KEYS.maxSilentWakes, path: ['rules', 'maxSilentWakes'] },
  { key: BOT_WAKE_SETTING_KEYS.ownerPresenceSeconds, path: ['rules', 'ownerPresenceSeconds'] },
  { key: BOT_WAKE_SETTING_KEYS.scope, path: ['rules', 'scope'] },
  { key: BOT_WAKE_SETTING_KEYS.windowSeconds, path: ['rules', 'windowSeconds'] },
  { key: BOT_WAKE_SETTING_KEYS.collectSeconds, path: ['scheduler', 'collectSeconds'] },
  { key: BOT_WAKE_SETTING_KEYS.cooldownSeconds, path: ['scheduler', 'cooldownSeconds'] },
  { key: BOT_WAKE_SETTING_KEYS.schedulerMode, path: ['scheduler', 'mode'] },
];

const readPath = (source: unknown, path: string[]) =>
  path.reduce<unknown>((value, segment) => (isRecord(value) ? value[segment] : undefined), source);

/**
 * Expands a hand-written nested `settings.botWake` into the flat keys the settings form renders,
 * dropping the nested object so the next save persists the migrated shape.
 *
 * The runtime deliberately prefers the nested object (see `gatherBotWakeSettings`), and the form
 * only reads the flat keys — so a channel configured the old way painted every control at its
 * default and its edits were ignored: an enabled bot looked switched off, and flipping the switch
 * changed nothing. The nested values win here for the same reason they win at runtime, and the
 * nested object is removed rather than copied so the form's own save is the migration. Anything
 * the nested object carries beyond the known options is dropped with it; the parser ignores those
 * keys at runtime too.
 *
 * Use when:
 * - Projecting a stored provider for the settings form (`getByAgentId`, `query`)
 *
 * Expects:
 * - `settings` is the provider's raw settings object; any shape, including `null`
 *
 * Returns:
 * - The same object when there is no nested `botWake`, otherwise settings with the flat keys set
 */
export const flattenBotWakeSettings = (
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined => {
  if (!isRecord(settings?.botWake)) return settings;

  const nested = settings.botWake;
  const flat = Object.fromEntries(
    BOT_WAKE_NESTED_PATHS.flatMap(({ key, path }) => {
      const value = readPath(nested, path);
      return isChosen(value) ? [[key, value]] : [];
    }),
  );
  // Every flat key goes: the nested object is authoritative at runtime, so a stale flat value it
  // does not mention would otherwise become live the moment the nested object is dropped.
  const flatKeys = new Set<string>(Object.values(BOT_WAKE_SETTING_KEYS));
  const rest = Object.fromEntries(
    Object.entries(settings).filter(([key]) => key !== 'botWake' && !flatKeys.has(key)),
  );

  return { ...rest, ...flat };
};

/**
 * Collects the bot-wake options from a provider's settings.
 *
 * A nested `botWake` object, which is how a hand-written config spells it, is taken as it is and
 * the flat form keys are not looked at. Anything else reads the flat keys the settings form
 * writes. The two are never merged field by field: the form always saves its defaults, so a
 * merge would let an untouched default quietly switch off what a hand-written config enabled.
 */
const gatherBotWakeSettings = (settings: Record<string, unknown> | null | undefined) => {
  if (isRecord(settings?.botWake)) return settings.botWake;

  const flat = (key: string) => settings?.[key];
  const k = BOT_WAKE_SETTING_KEYS;

  return {
    ...chosen({
      customInstructions: flat(k.customInstructions),
      enabled: flat(k.enabled),
      mode: flat(k.mode),
    }),
    classifier: chosen({ mode: flat(k.classifierMode), threshold: flat(k.classifierThreshold) }),
    rules: chosen({
      allowChannels: flat(k.allowChannels),
      denyChannels: flat(k.denyChannels),
      maxSilentWakes: flat(k.maxSilentWakes),
      ownerPresenceSeconds: flat(k.ownerPresenceSeconds),
      scope: flat(k.scope),
      windowSeconds: flat(k.windowSeconds),
    }),
    scheduler: chosen({
      collectSeconds: flat(k.collectSeconds),
      cooldownSeconds: flat(k.cooldownSeconds),
      mode: flat(k.schedulerMode),
    }),
  };
};

export interface ParsedBotWakeSettings {
  config: BotWakeConfig;
  /** Mode of the rule policies (internal rules, owner rules). */
  ruleMode: WakePolicyMode;
  rules: WakeRules;
  scheduler: ResolvedWakeScheduler;
}

/**
 * Parses the provider's bot-wake settings (a nested `botWake` object, else the flat form keys) into
 * a config with defaults applied.
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
  const parsed = SettingsSchema.safeParse(gatherBotWakeSettings(settings));
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
