import type { FieldSchema } from '@/server/services/bot/platforms/types';

import { isFieldReleased } from './formState';

/**
 * The fields under one top-level section of a platform schema, with nested
 * object sections flattened into their children. Dev-only fields stay out of
 * production builds, and a field behind a rollout flag shows only when the
 * user's flag is on.
 */
export const getSchemaFields = (
  schema: FieldSchema[],
  sectionKey: string,
  featureFlags?: Record<string, unknown>,
): FieldSchema[] => {
  const section = schema.find((field) => field.key === sectionKey);
  if (!section?.properties) return [];

  const shown = (field: FieldSchema) =>
    (!field.devOnly || __DEV__) && isFieldReleased(field, featureFlags);

  return section.properties.filter(shown).flatMap((field) => {
    if (field.type === 'object' && field.properties) return field.properties.filter(shown);
    return field;
  });
};

export type SettingsGroupKey = 'access' | 'advanced' | 'connect' | 'reply' | 'wake';

export interface SettingsGroup {
  fields: FieldSchema[];
  key: SettingsGroupKey;
}

/**
 * Who the bot talks to, in the order a person decides it: who you are and which
 * server is yours, then DMs
 * (and the list they lean on), then groups.
 */
const ACCESS_KEYS = [
  'userId',
  'serverId',
  'dmPolicy',
  'allowFrom',
  'guestPolicy',
  'groupPolicy',
  'groupAllowFrom',
];

/** What a reply looks like in the chat. */
export const REPLY_KEYS = ['displayToolCalls', 'showUsageStats', 'reactionMode'];

/**
 * When the bot speaks up without being @mentioned: first the keywords that wake it, then the
 * bot-wake rules, which all share one prefix and judge the messages nobody addressed to it.
 */
const WAKE_KEYS = ['watchKeywords'];
export const WAKE_KEY_PREFIX = 'botWake';

/** How the bot reaches the platform: how events arrive. */
const CONNECT_KEYS = ['connectionMode'];

/**
 * Split a platform's flat settings fields into the sections the page shows (one per tab).
 *
 * The schema stays the single source of truth: a field a platform adds later
 * that is not named above lands in `advanced`, so nothing a schema declares can
 * vanish from the page. Empty sections are dropped, so a platform that has no
 * access controls (WeChat, LINE) simply has no such section.
 */
export const groupSettingsFields = (fields: FieldSchema[]): SettingsGroup[] => {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const pick = (keys: string[]) =>
    keys.map((key) => byKey.get(key)).filter((field): field is FieldSchema => !!field);

  const connect = pick(CONNECT_KEYS);
  const access = pick(ACCESS_KEYS);
  const reply = pick(REPLY_KEYS);
  const wake = [
    ...pick(WAKE_KEYS),
    ...fields.filter((field) => field.key.startsWith(WAKE_KEY_PREFIX)),
  ];
  const placed = new Set([...connect, ...access, ...wake, ...reply].map((field) => field.key));
  const advanced = fields.filter((field) => !placed.has(field.key));

  return (
    [
      { fields: connect, key: 'connect' },
      { fields: access, key: 'access' },
      { fields: wake, key: 'wake' },
      { fields: reply, key: 'reply' },
      { fields: advanced, key: 'advanced' },
    ] satisfies SettingsGroup[]
  ).filter((group) => group.fields.length > 0);
};
