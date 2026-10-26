import type { FieldSchema } from '@/server/services/bot/platforms/types';

/**
 * Sections of a channel's settings, in page order. Each answers one question an
 * operator has after the bot is connected: who may talk to it, which platform
 * account is theirs, how it replies, and when it wakes up on its own.
 */
export const SETTINGS_SECTIONS = ['access', 'account', 'replies', 'wake', 'other'] as const;

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number];

/**
 * Where a settings key renders. `connection` keys join the credential card,
 * because they change how the bot reaches the platform rather than how it
 * behaves. Kept on the client so the platform schemas stay presentation-free;
 * a key nobody mapped falls through to `other` instead of disappearing.
 */
const SECTION_BY_KEY: Record<string, SettingsSectionKey | 'connection'> = {
  allowFrom: 'access',
  charLimit: 'replies',
  concurrency: 'replies',
  connectionMode: 'connection',
  debounceMs: 'replies',
  displayToolCalls: 'replies',
  dmPolicy: 'access',
  groupAllowFrom: 'access',
  groupPolicy: 'access',
  guestPolicy: 'access',
  historyLimit: 'replies',
  reactionMode: 'replies',
  serverId: 'account',
  showUsageStats: 'replies',
  userId: 'account',
  watchKeywords: 'wake',
};

export const getSettingsSection = (key: string): SettingsSectionKey | 'connection' =>
  SECTION_BY_KEY[key] ?? (key.startsWith('botWake') ? 'wake' : 'other');

export interface SettingsSectionGroup {
  fields: FieldSchema[];
  key: SettingsSectionKey;
}

/**
 * Splits flattened settings fields into the connection fields and the ordered,
 * non-empty settings sections. Fields keep their schema order inside a section.
 */
export const groupSettingsFields = (fields: FieldSchema[]) => {
  const connection: FieldSchema[] = [];
  const buckets = new Map<SettingsSectionKey, FieldSchema[]>();

  for (const field of fields) {
    const section = getSettingsSection(field.key);
    if (section === 'connection') {
      connection.push(field);
      continue;
    }
    const bucket = buckets.get(section) ?? [];
    bucket.push(field);
    buckets.set(section, bucket);
  }

  const sections: SettingsSectionGroup[] = SETTINGS_SECTIONS.flatMap((key) => {
    const sectionFields = buckets.get(key);
    return sectionFields?.length ? [{ fields: sectionFields, key }] : [];
  });

  return { connection, sections };
};
