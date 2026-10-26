import { describe, expect, it } from 'vitest';

import { schema as discordSchema } from '@/server/services/bot/platforms/discord/schema';
import { sharedSchema as feishuSchema } from '@/server/services/bot/platforms/feishu/definitions/schema';
import { schema as imessageSchema } from '@/server/services/bot/platforms/imessage/schema';
import { schema as lineSchema } from '@/server/services/bot/platforms/line/schema';
import { schema as qqSchema } from '@/server/services/bot/platforms/qq/schema';
import { schema as slackSchema } from '@/server/services/bot/platforms/slack/schema';
import { schema as telegramSchema } from '@/server/services/bot/platforms/telegram/schema';
import type { FieldSchema } from '@/server/services/bot/platforms/types';
import { schema as wechatSchema } from '@/server/services/bot/platforms/wechat/schema';

import { getSettingsSection, groupSettingsFields } from './sections';

const settingsOf = (schema: FieldSchema[]) =>
  schema.find((section) => section.key === 'settings')?.properties ?? [];

const PLATFORM_SCHEMAS: Record<string, FieldSchema[]> = {
  discord: discordSchema,
  feishu: feishuSchema,
  imessage: imessageSchema,
  line: lineSchema,
  qq: qqSchema,
  slack: slackSchema,
  telegram: telegramSchema,
  wechat: wechatSchema,
};

describe('channel settings sections', () => {
  it.each(Object.entries(PLATFORM_SCHEMAS))(
    'files every %s setting under a named section, never the fallback',
    (_platform, schema) => {
      const unmapped = settingsOf(schema)
        .map((field) => field.key)
        .filter((key) => getSettingsSection(key) === 'other');

      expect(unmapped).toEqual([]);
    },
  );

  it('puts who-can-talk policies together, ahead of reply behaviour', () => {
    const { sections } = groupSettingsFields(settingsOf(discordSchema));

    expect(sections.map((section) => section.key)).toEqual([
      'access',
      'account',
      'replies',
      'wake',
    ]);
    expect(sections[0].fields.map((field) => field.key)).toEqual([
      'dmPolicy',
      'groupPolicy',
      'groupAllowFrom',
      'allowFrom',
    ]);
  });

  it('moves the connection mode next to the credentials', () => {
    const { connection, sections } = groupSettingsFields(settingsOf(slackSchema));

    expect(connection.map((field) => field.key)).toEqual(['connectionMode']);
    expect(sections.flatMap((section) => section.fields).map((field) => field.key)).not.toContain(
      'connectionMode',
    );
  });

  it('keeps an unknown key visible under the fallback section', () => {
    const { sections } = groupSettingsFields([
      { key: 'charLimit', label: '', type: 'number' },
      { key: 'somethingNew', label: '', type: 'string' },
    ]);

    expect(sections).toEqual([
      { fields: [{ key: 'charLimit', label: '', type: 'number' }], key: 'replies' },
      { fields: [{ key: 'somethingNew', label: '', type: 'string' }], key: 'other' },
    ]);
  });

  it('drops sections a platform has no fields for', () => {
    const { sections } = groupSettingsFields(settingsOf(wechatSchema));

    expect(sections.map((section) => section.key)).toEqual(['replies', 'wake']);
  });
});
