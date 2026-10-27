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

export type WakeSectionKey = 'channels' | 'judgement' | 'keywords' | 'more' | 'pace';

export interface WakeSection {
  fields: FieldSchema[];
  key: WakeSectionKey;
}

/**
 * The wake tab's blocks, in page order, and the options each holds, in the order a person sets
 * them. The strings are the keys of `BOT_WAKE_SETTING_KEYS` (a test keeps the two in step); they
 * are spelled out here so the page does not pull the server's settings parser into the bundle.
 *
 * - judgement (shown as "initiative"), first: the decision a person makes before any other, when
 *   the bot may speak up without being called. In the order a person thinks about it: for me (the
 *   owner's own remarks), for others (a message plainly for the bot that nobody addressed to it),
 *   then the custom instructions behind both. Each is a switch with its dial or text area opening
 *   under it.
 * - keywords: words that wake the bot with no @
 * - channels: where it may join a conversation nobody addressed to it
 * - pace: how soon and how often it speaks up on its own, as a preset; `custom` opens the numbers
 *   (and how sure it must be that a message right after its own reply is still for it)
 */
const WAKE_SECTION_KEYS: Array<[Exclude<WakeSectionKey, 'more'>, string[]]> = [
  [
    'judgement',
    [
      'botWakeProactiveEnabled',
      'botWakeProactiveThreshold',
      'botWakeClassifierInitiateEnabled',
      'botWakeClassifierInitiateThreshold',
      'botWakeCustomInstructionsEnabled',
      'botWakeCustomInstructions',
    ],
  ],
  ['keywords', ['watchKeywords']],
  ['channels', ['botWakeScope', 'botWakeAllowChannels', 'botWakeDenyChannels']],
  [
    'pace',
    [
      'botWakePace',
      'botWakeWindowSeconds',
      'botWakeClassifierThreshold',
      'botWakeMaxSilentWakes',
      'botWakeOwnerPresenceSeconds',
      'botWakeSchedulerMode',
      'botWakeCollectSeconds',
      'botWakeCooldownSeconds',
    ],
  ],
];

/** The hidden master switch is not an option a person sets. */
const WAKE_MASTER = 'botWakeEnabled';

/**
 * Split the wake tab's fields into the blocks the page shows. Empty blocks are dropped, so a user
 * the bot-wake options are not released to sees only the keywords. An option not named above
 * lands in a `more` block, so a field the schema adds later cannot vanish from the page.
 */
export const groupWakeFields = (fields: FieldSchema[]): WakeSection[] => {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const placed = new Set<string>([WAKE_MASTER]);

  const sections: WakeSection[] = WAKE_SECTION_KEYS.map(([key, keys]) => {
    keys.forEach((k) => placed.add(k));

    return {
      fields: keys.map((k) => byKey.get(k)).filter((field): field is FieldSchema => !!field),
      key,
    };
  });

  const more: WakeSection = {
    fields: fields.filter((field) => !placed.has(field.key)),
    key: 'more',
  };

  return [...sections, more].filter((section) => section.fields.length > 0);
};

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
