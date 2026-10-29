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

export type AccessSectionKey = 'conversation' | 'device' | 'identity';

export interface AccessSectionGroup {
  fields: FieldSchema[];
  key: AccessSectionKey;
}

/**
 * The access tab's blocks, in page order, each answering one question:
 *
 * - identity: who the owner is (their own ID, and the server that is theirs)
 * - conversation: who may talk to the bot, in DMs (and the list they lean on) and in groups
 * - device: who, besides the owner, may use the owner's devices through the bot
 */
const ACCESS_SECTION_KEYS: Array<[AccessSectionKey, string[]]> = [
  ['identity', ['userId', 'serverId']],
  ['conversation', ['dmPolicy', 'allowFrom', 'guestPolicy', 'groupPolicy', 'groupAllowFrom']],
  ['device', ['devicePolicy', 'deviceAllowFrom']],
];

const ACCESS_KEYS = ACCESS_SECTION_KEYS.flatMap(([, keys]) => keys);

/** Split the access tab's fields into its blocks. Empty blocks are dropped. */
export const groupAccessFields = (fields: FieldSchema[]): AccessSectionGroup[] => {
  const byKey = new Map(fields.map((field) => [field.key, field]));

  return ACCESS_SECTION_KEYS.map(([key, keys]) => ({
    fields: keys.map((k) => byKey.get(k)).filter((field): field is FieldSchema => !!field),
    key,
  })).filter((section) => section.fields.length > 0);
};

/** What a reply looks like in the chat. These save themselves as soon as they change. */
export const REPLY_KEYS = ['replyPlacement', 'displayToolCalls', 'showUsageStats', 'reactionMode'];

/**
 * How the bot talks: its style everywhere, a style per channel, and the emoji it may use. Long
 * text a person writes and rewrites, so it waits for its own Save instead of saving per keystroke.
 */
export const REPLY_STYLE_KEYS = ['replyStyle', 'channelReplyStyles', 'replyEmojis'];

export type ReplySectionKey = 'display' | 'style';

export interface ReplySection {
  fields: FieldSchema[];
  key: ReplySectionKey;
}

/** Split the reply tab's fields into how a reply looks and how the bot talks. Empty blocks are dropped. */
export const groupReplyFields = (fields: FieldSchema[]): ReplySection[] => {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const pick = (keys: string[]) =>
    keys.map((key) => byKey.get(key)).filter((field): field is FieldSchema => !!field);

  return (
    [
      { fields: pick(REPLY_KEYS), key: 'display' },
      { fields: pick(REPLY_STYLE_KEYS), key: 'style' },
    ] satisfies ReplySection[]
  ).filter((section) => section.fields.length > 0);
};

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
 * - judgement (shown as "duties"), first: the decision a person makes before any other, what the
 *   bot is responsible for, so it may speak up without being called when a message falls within
 *   it. The duties text area with its dial under it, then the custom instructions (a switch with
 *   its text area opening under it) that guide every judgement.
 * - keywords: words that wake the bot with no @
 * - channels: where it may join a conversation nobody addressed to it
 * - pace: how soon and how often it speaks up on its own, as a preset; `custom` opens the numbers
 *   (and how sure it must be that a message right after its own reply is still for it)
 */
const WAKE_SECTION_KEYS: Array<[Exclude<WakeSectionKey, 'more'>, string[]]> = [
  [
    'judgement',
    [
      'botWakeDuties',
      'botWakeDutiesThreshold',
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
  const reply = pick([...REPLY_KEYS, ...REPLY_STYLE_KEYS]);
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
