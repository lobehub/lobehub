// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  BOT_WAKE_SETTING_KEYS,
  DEFAULT_WAKE_RULES,
  MIN_COLLECT_SECONDS,
  MIN_COOLDOWN_SECONDS,
  parseBotWakeSettings,
} from '@/server/services/agentSignal/scenarios/botWake/config';

import agentLocale from '../../../../../../../packages/locales/src/default/agent';
import { botWakeFields } from '../botWakeFields';
import { schema as discordSchema } from '../discord/schema';
import type { FieldSchema } from '../types';
import { mergeWithDefaults } from '../utils';

const settingsFields = (schema: FieldSchema[]) =>
  schema.find((field) => field.key === 'settings')!.properties!;

/** Every i18n key a field points at, including the ones the list editor derives from its label. */
const referencedKeys = (field: FieldSchema): string[] => [
  field.label,
  ...(field.description ? [field.description] : []),
  ...(field.placeholder ? [field.placeholder] : []),
  ...(field.enumLabels ?? []),
  ...(field.enumDescriptions ?? []),
  ...(field.type === 'array' ? [`${field.label}Add`, `${field.label}Empty`] : []),
  ...(field.items?.properties ?? []).flatMap(referencedKeys),
];

describe('bot-wake settings fields', () => {
  it('are exactly the keys the runtime reads', () => {
    expect(botWakeFields.map((field) => field.key).sort()).toEqual(
      Object.values(BOT_WAKE_SETTING_KEYS).sort(),
    );
  });

  it('are shown by the Discord form', () => {
    const keys = settingsFields(discordSchema).map((field) => field.key);

    for (const field of botWakeFields) expect(keys).toContain(field.key);
  });

  it('stay hidden until the bot_wake rollout reaches the user', () => {
    for (const field of botWakeFields) expect(field.featureFlag).toBe('enableBotWake');
  });

  it('show only the master switch until it is on, and the scheduler timings until it batches', () => {
    const unconditional = botWakeFields.filter((field) => !field.visibleWhen);

    expect(unconditional.map((field) => field.key)).toEqual([BOT_WAKE_SETTING_KEYS.enabled]);
    for (const key of [
      BOT_WAKE_SETTING_KEYS.collectSeconds,
      BOT_WAKE_SETTING_KEYS.cooldownSeconds,
    ]) {
      expect(botWakeFields.find((field) => field.key === key)!.visibleWhen).toEqual({
        field: BOT_WAKE_SETTING_KEYS.schedulerMode,
        value: 'enforce',
      });
    }
  });

  it('only offers timings the scheduler would accept', () => {
    const byKey = Object.fromEntries(botWakeFields.map((field) => [field.key, field]));

    expect(byKey[BOT_WAKE_SETTING_KEYS.collectSeconds].minimum).toBe(MIN_COLLECT_SECONDS);
    expect(byKey[BOT_WAKE_SETTING_KEYS.cooldownSeconds].minimum).toBe(MIN_COOLDOWN_SECONDS);
  });

  it('have a user-facing text for every key they point at', () => {
    const missing = botWakeFields.flatMap(referencedKeys).filter((key) => !(key in agentLocale));

    expect(missing).toEqual([]);
  });

  it('do not switch off a hand-written botWake config when the form defaults are merged in', () => {
    // The save and load paths merge every schema default into the settings, so this is the shape a
    // bot configured with a nested `botWake` object really has at runtime.
    const settings = mergeWithDefaults(discordSchema, {
      botWake: { classifier: { mode: 'enforce' }, enabled: true, rules: { scope: 'bot-threads' } },
    });

    expect(settings[BOT_WAKE_SETTING_KEYS.enabled]).toBe(false);

    const parsed = parseBotWakeSettings(settings);
    expect(parsed.config.enabled).toBe(true);
    expect(parsed.rules.classifier.mode).toBe('enforce');
    expect(parsed.rules.scope).toBe('bot-threads');
  });

  it('enable the pipeline from the form once its switch is on', () => {
    const settings = mergeWithDefaults(discordSchema, { [BOT_WAKE_SETTING_KEYS.enabled]: true });

    const parsed = parseBotWakeSettings(settings);
    expect(parsed.config.enabled).toBe(true);
    expect(parsed.ruleMode).toBe('shadow');
    expect(parsed.rules.classifier.mode).toBe('shadow');
  });

  it('leave a bot that saved the form untouched exactly as it was before: off, with the stock rules', () => {
    const untouched = Object.fromEntries(
      botWakeFields
        .filter((field) => field.default !== undefined)
        .map((field) => [field.key, field.default]),
    );

    const parsed = parseBotWakeSettings(untouched);

    expect(parsed.config.enabled).toBe(false);
    expect(parsed.rules).toEqual({ ...DEFAULT_WAKE_RULES, customInstructions: undefined });
    expect(parsed.scheduler.mode).toBe('off');
    expect(parsed.ruleMode).toBe('shadow');
  });
});
