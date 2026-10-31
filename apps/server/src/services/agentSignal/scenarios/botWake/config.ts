import { z } from 'zod';

import { isBotWakeEnabled } from './gate';
import type { BotWakeConfig, WakePolicyMode, WakeRules, WakeSchedulerConfig } from './types';

export const DEFAULT_WAKE_RULES: WakeRules = {
  allowChannels: [],
  // A follow-up in the window is answered only when the classifier is fairly sure it is for the bot:
  // in a thread with several people and bots, 0.5-0.75 is mostly the owner talking to someone else.
  classifier: { mode: 'enforce', threshold: 0.75 },
  denyChannels: [],
  // Off until the bot has duties: without the text there is nothing to judge a message against.
  // The decision model scores plain feature requests 0.65-0.76, so 0.8 let almost none through.
  duties: { mode: 'enforce', threshold: 0.65 },
  maxSilentWakes: 3,
  ownerPresenceSeconds: 120,
  scope: 'all',
  windowSeconds: 300,
};

/**
 * How often the bot speaks up on its own, as one choice instead of seven numbers. `custom` keeps
 * the numbers the owner set; a config without a pace (saved before it existed, or written by hand)
 * reads as `custom`, so nothing an owner tuned is overridden.
 */
export const BOT_WAKE_PACES = ['calm', 'balanced', 'active', 'custom'] as const;
export type BotWakePace = (typeof BOT_WAKE_PACES)[number];

export interface BotWakePacePreset {
  /** Score the classifier must reach for a message in the follow-up window to wake the bot. */
  classifierThreshold: number;
  maxSilentWakes: number;
  ownerPresenceSeconds: number;
  scheduler: Required<WakeSchedulerConfig>;
  windowSeconds: number;
}

/** `balanced` is the defaults, so a bot that never touched the numbers keeps behaving the same. */
export const BOT_WAKE_PACE_PRESETS: Record<Exclude<BotWakePace, 'custom'>, BotWakePacePreset> = {
  active: {
    classifierThreshold: 0.75,
    maxSilentWakes: 5,
    ownerPresenceSeconds: 0,
    scheduler: { collectSeconds: 20, cooldownSeconds: 60, mode: 'off' },
    windowSeconds: 600,
  },
  balanced: {
    classifierThreshold: 0.75,
    maxSilentWakes: 3,
    ownerPresenceSeconds: 120,
    scheduler: { collectSeconds: 20, cooldownSeconds: 60, mode: 'off' },
    windowSeconds: 300,
  },
  calm: {
    classifierThreshold: 0.75,
    maxSilentWakes: 1,
    ownerPresenceSeconds: 300,
    scheduler: { collectSeconds: 30, cooldownSeconds: 180, mode: 'enforce' },
    windowSeconds: 120,
  },
};

/** Classifier thresholds a pace-less config holds when nobody tuned it: the form's old and current default. */
const UNTOUCHED_CLASSIFIER_THRESHOLDS = new Set<number>([
  0.5,
  BOT_WAKE_PACE_PRESETS.balanced.classifierThreshold,
]);

/** Spec: a burst is collected for at least 20s, and a run is followed by at least 60s of cooldown. */
export const MIN_COLLECT_SECONDS = 20;
export const MIN_COOLDOWN_SECONDS = 60;

export interface ResolvedWakeScheduler {
  collectMs: number;
  cooldownMs: number;
  mode: 'enforce' | 'off';
}

/**
 * Longest custom instruction handed to the classifier; longer text is cut, not rejected. Long
 * enough for a real prompt (who to answer, who to leave alone, examples), short enough to stay a
 * small fraction of the classifier's input.
 */
export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4000;

/**
 * Longest duty text handed to the duty judge; longer text is cut, not rejected. Same budget as the
 * custom instructions: a list of what the bot is responsible for, with an example or two each.
 */
export const MAX_DUTIES_LENGTH = 4000;

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
    customInstructionsEnabled: z.boolean().optional().catch(undefined),
    duties: z
      .object({
        mode: mode.catch(DEFAULT_WAKE_RULES.duties.mode),
        text: z.string().catch(''),
        threshold: z.number().min(0).max(1).catch(DEFAULT_WAKE_RULES.duties.threshold),
      })
      .partial()
      .catch({}),
    enabled: z.boolean().catch(false),
    mode: mode.catch('enforce'),
    pace: z.enum(BOT_WAKE_PACES).optional().catch(undefined),
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
 *
 * There is no key for the rules', the classifier's or the duty judge's mode: with bot-wake on they
 * always enforce, and a value an earlier form saved for them is ignored. Only a hand-written nested
 * `botWake` object can still ask for `shadow` or `off`, as an operator's override (see
 * `BotWakeConfig`).
 */
export const BOT_WAKE_SETTING_KEYS = {
  allowChannels: 'botWakeAllowChannels',
  classifierThreshold: 'botWakeClassifierThreshold',
  collectSeconds: 'botWakeCollectSeconds',
  cooldownSeconds: 'botWakeCooldownSeconds',
  customInstructions: 'botWakeCustomInstructions',
  customInstructionsEnabled: 'botWakeCustomInstructionsEnabled',
  denyChannels: 'botWakeDenyChannels',
  duties: 'botWakeDuties',
  dutiesThreshold: 'botWakeDutiesThreshold',
  /**
   * The off switch. Absent means on: every bot speaks up on its own unless its owner turned it
   * off. It replaced `botWakeEnabled`, which the form saved as `false` for every bot while the
   * switch was still hidden, so that key is retired rather than read.
   */
  disabled: 'botWakeDisabled',
  maxSilentWakes: 'botWakeMaxSilentWakes',
  ownerPresenceSeconds: 'botWakeOwnerPresenceSeconds',
  pace: 'botWakePace',
  schedulerMode: 'botWakeSchedulerMode',
  scope: 'botWakeScope',
  windowSeconds: 'botWakeWindowSeconds',
} as const;

/**
 * Flat keys earlier forms wrote for options that no longer exist: "help others" (the classifier
 * starting a wake on its own) and "help me" (offering the owner help), both replaced by the duties.
 * The parser never reads them; the form projection drops them, so the next save clears them.
 */
const RETIRED_BOT_WAKE_SETTING_KEYS = new Set([
  'botWakeEnabled',
  'botWakeClassifierInitiateEnabled',
  'botWakeClassifierInitiateThreshold',
  'botWakeProactiveEnabled',
  'botWakeProactiveThreshold',
]);

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
  { key: BOT_WAKE_SETTING_KEYS.customInstructions, path: ['customInstructions'] },
  {
    key: BOT_WAKE_SETTING_KEYS.customInstructionsEnabled,
    path: ['customInstructionsEnabled'],
  },
  { key: BOT_WAKE_SETTING_KEYS.classifierThreshold, path: ['classifier', 'threshold'] },
  { key: BOT_WAKE_SETTING_KEYS.duties, path: ['duties', 'text'] },
  { key: BOT_WAKE_SETTING_KEYS.dutiesThreshold, path: ['duties', 'threshold'] },
  { key: BOT_WAKE_SETTING_KEYS.pace, path: ['pace'] },
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

/**
 * The modes an operator can still set by hand in a nested `settings.botWake`: `mode` for the rules,
 * `classifier.mode` for the classifier and `duties.mode` for the duty judge (`shadow` to only score
 * it). The settings form has no control for them, so they are the one part of a nested config that
 * stays nested: every other option is projected onto the flat keys the form edits, and the form
 * writes the settings back whole.
 */
const readModeOverrides = (nested: Record<string, unknown>) => {
  const mode = readPath(nested, ['mode']);
  const classifierMode = readPath(nested, ['classifier', 'mode']);
  const dutiesMode = readPath(nested, ['duties', 'mode']);
  if (!isChosen(mode) && !isChosen(classifierMode) && !isChosen(dutiesMode)) return undefined;

  return {
    ...(isChosen(classifierMode) ? { classifier: { mode: classifierMode } } : {}),
    ...(isChosen(dutiesMode) ? { duties: { mode: dutiesMode } } : {}),
    ...(isChosen(mode) ? { mode } : {}),
  };
};

/**
 * A nested config that holds nothing but the mode overrides, beside the flat options. `proactive`
 * is the override of the retired "help me" judge: a config that still carries it is an override
 * object all the same, so the flat options stay live, and the retired mode is ignored.
 */
const isModeOverrideOnly = (nested: Record<string, unknown>) => {
  const keys = Object.keys(nested);
  const modeOnly = (value: unknown) =>
    value === undefined || (isRecord(value) && Object.keys(value).every((key) => key === 'mode'));

  return (
    keys.length > 0 &&
    keys.every((key) => ['classifier', 'duties', 'mode', 'proactive'].includes(key)) &&
    modeOnly(nested.classifier) &&
    modeOnly(nested.duties) &&
    modeOnly(nested.proactive)
  );
};

const readPath = (source: unknown, path: string[]) =>
  path.reduce<unknown>((value, segment) => (isRecord(value) ? value[segment] : undefined), source);

/**
 * Instructions written before their switch existed are live (the parser reads an absent switch as
 * on), so the form must show the switch on. Left at the form's default, the next save would write
 * `false` and silently stop handing them to the classifier.
 */
/**
 * The pace a stored config shows in the form. Saved, it is what it says. Without one, the numbers
 * decide: the defaults read as `balanced`, anything an owner tuned as `custom`, so the form neither
 * hides the numbers nor lets a save replace them with a preset.
 */
const withPace = (
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined => {
  const k = BOT_WAKE_SETTING_KEYS;
  if (!settings || isChosen(settings[k.pace])) return settings;
  // Only a bot with bot-wake options has a pace to show.
  if (!Object.keys(settings).some((key) => key !== 'botWake' && key.startsWith('botWake'))) {
    return settings;
  }

  const { balanced } = BOT_WAKE_PACE_PRESETS;
  const read = (key: string, fallback: unknown) =>
    isChosen(settings[key]) ? settings[key] : fallback;
  const untouched =
    read(k.windowSeconds, balanced.windowSeconds) === balanced.windowSeconds &&
    read(k.maxSilentWakes, balanced.maxSilentWakes) === balanced.maxSilentWakes &&
    read(k.ownerPresenceSeconds, balanced.ownerPresenceSeconds) === balanced.ownerPresenceSeconds &&
    read(k.schedulerMode, balanced.scheduler.mode) === balanced.scheduler.mode &&
    // A preset sets the threshold too, so a tuned one must read as custom or the next save would
    // replace it. The form saved its default, 0.5 before presets owned it, so that is untouched.
    UNTOUCHED_CLASSIFIER_THRESHOLDS.has(
      read(k.classifierThreshold, balanced.classifierThreshold) as number,
    );

  return { ...settings, [k.pace]: untouched ? 'balanced' : 'custom' };
};

/** Settings without the {@link RETIRED_BOT_WAKE_SETTING_KEYS}; the same object when it has none. */
const withoutRetiredKeys = (
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined => {
  if (!settings || !Object.keys(settings).some((key) => RETIRED_BOT_WAKE_SETTING_KEYS.has(key))) {
    return settings;
  }

  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !RETIRED_BOT_WAKE_SETTING_KEYS.has(key)),
  );
};

const withInstructionsSwitch = (
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined => {
  const k = BOT_WAKE_SETTING_KEYS;
  const text = settings?.[k.customInstructions];
  if (!settings || isChosen(settings[k.customInstructionsEnabled])) return settings;
  if (typeof text !== 'string' || !text.trim()) return settings;

  return { ...settings, [k.customInstructionsEnabled]: true };
};

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
  settings = withoutRetiredKeys(settings);
  if (!isRecord(settings?.botWake)) return withPace(withInstructionsSwitch(settings));

  const nested = settings.botWake;
  const flat = {
    ...Object.fromEntries(
      BOT_WAKE_NESTED_PATHS.flatMap(({ key, path }) => {
        const value = readPath(nested, path);
        return isChosen(value) ? [[key, value]] : [];
      }),
    ),
    // A hand-written config is off unless it says `enabled: true`; the flat key is the off switch.
    [BOT_WAKE_SETTING_KEYS.disabled]: readPath(nested, ['enabled']) !== true,
  };
  // Every flat key goes: the nested object is authoritative at runtime, so a stale flat value it
  // does not mention would otherwise become live the moment the nested object is dropped.
  const flatKeys = new Set<string>(Object.values(BOT_WAKE_SETTING_KEYS));
  const rest = Object.fromEntries(
    Object.entries(settings).filter(([key]) => key !== 'botWake' && !flatKeys.has(key)),
  );
  // An operator's mode override has no flat key, so it stays nested: the form writes this object
  // back whole, and dropping it here would silently turn the override into the default.
  const overrides = readModeOverrides(nested);

  return withPace(
    withInstructionsSwitch({ ...rest, ...flat, ...(overrides ? { botWake: overrides } : {}) }),
  );
};

/**
 * Collects the bot-wake options from a provider's settings.
 *
 * A nested `botWake` object, which is how a hand-written config spells it, is taken as it is and
 * the flat form keys are not looked at. Anything else reads the flat keys the settings form
 * writes. The two are never merged field by field: the form always saves its defaults, so a
 * merge would let an untouched default quietly switch off what a hand-written config enabled.
 * The one exception is a nested object that holds only the mode overrides: it sits beside the
 * flat options, which are read as usual, and applies its modes on top.
 */
const gatherBotWakeSettings = (settings: Record<string, unknown> | null | undefined) => {
  const nested = settings?.botWake;
  // A hand-written config is taken as it is. One that holds only the mode overrides is what a
  // projected config looks like once the form has saved it: the options are in the flat keys.
  if (isRecord(nested) && !isModeOverrideOnly(nested)) return nested;

  const flat = (key: string) => settings?.[key];
  const k = BOT_WAKE_SETTING_KEYS;
  const overrides = isRecord(nested) ? readModeOverrides(nested) : undefined;

  return {
    ...chosen({
      customInstructions: flat(k.customInstructions),
      customInstructionsEnabled: flat(k.customInstructionsEnabled),
      pace: flat(k.pace),
    }),
    enabled: flat(k.disabled) !== true,
    ...(overrides && 'mode' in overrides ? { mode: overrides.mode } : {}),
    classifier: {
      ...chosen({ threshold: flat(k.classifierThreshold) }),
      ...overrides?.classifier,
    },
    duties: {
      ...chosen({ text: flat(k.duties), threshold: flat(k.dutiesThreshold) }),
      ...overrides?.duties,
    },
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

  // A pace other than `custom` sets the timings and the classifier threshold; the numbers saved
  // beside it are not read.
  const preset = raw.pace && raw.pace !== 'custom' ? BOT_WAKE_PACE_PRESETS[raw.pace] : undefined;

  const rules: WakeRules = {
    ...DEFAULT_WAKE_RULES,
    ...raw.rules,
    ...(preset && {
      maxSilentWakes: preset.maxSilentWakes,
      ownerPresenceSeconds: preset.ownerPresenceSeconds,
      windowSeconds: preset.windowSeconds,
    }),
    // The form always saves the threshold, so a preset must override it like the timings: a
    // `balanced` bot saved when the default was 0.5 would otherwise keep waking on idle chatter.
    classifier: {
      ...DEFAULT_WAKE_RULES.classifier,
      ...raw.classifier,
      ...(preset && { threshold: preset.classifierThreshold }),
    },
    // Switched off, the text stays in the settings but is not handed to the classifier.
    customInstructions:
      raw.customInstructionsEnabled === false
        ? undefined
        : raw.customInstructions?.trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH) || undefined,
    // No text, no duties: the judge is left out of the set, so nothing is asked of a model.
    duties: {
      mode: raw.duties?.mode ?? DEFAULT_WAKE_RULES.duties.mode,
      text: raw.duties?.text?.trim().slice(0, MAX_DUTIES_LENGTH) || undefined,
      threshold: raw.duties?.threshold ?? DEFAULT_WAKE_RULES.duties.threshold,
    },
  };

  const schedulerRaw: WakeSchedulerConfig = preset?.scheduler ?? raw.scheduler ?? {};

  return {
    config: { ...raw, rules },
    rules,
    ruleMode: raw.mode ?? 'enforce',
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
