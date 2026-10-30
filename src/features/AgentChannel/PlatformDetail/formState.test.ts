import { describe, expect, it } from 'vitest';

import { BOT_WAKE_SETTING_KEYS } from '@/server/services/agentSignal/scenarios/botWake/config';
import type { FieldSchema } from '@/server/services/bot/platforms/types';

import {
  extractSettingsDefaults,
  findOverLimitSettings,
  getChannelFormValues,
  isFieldReleased,
  isWakeMasterReleased,
  mergeCredentialsForSave,
  mergeSettingsWithDefaults,
  shouldAdoptIncomingConfig,
  withWakeMasterOn,
} from './formState';

const slackSchema: FieldSchema[] = [
  {
    key: 'settings',
    label: 'Settings',
    properties: [
      { default: 'websocket', key: 'connectionMode', label: '', type: 'string' },
      { default: 4000, key: 'charLimit', label: '', type: 'number' },
      { key: 'showUsageStats', label: '', type: 'boolean' },
      {
        key: 'nested',
        label: '',
        properties: [{ default: 'queue', key: 'concurrency', label: '', type: 'string' }],
        type: 'object',
      },
    ],
    type: 'object',
  },
];

describe('getChannelFormValues', () => {
  it('should keep bot settings nested under the settings field', () => {
    expect(
      getChannelFormValues({
        applicationId: 'bot-123',
        credentials: { botToken: 'secret' },
        settings: { debounceMs: 300, enableDM: true },
      }),
    ).toEqual({
      applicationId: 'bot-123',
      credentials: { botToken: 'secret' },
      settings: { debounceMs: 300, enableDM: true },
    });
  });

  it('should default missing nested objects to empty objects', () => {
    expect(
      getChannelFormValues({
        applicationId: 'bot-123',
      }),
    ).toEqual({
      applicationId: 'bot-123',
      credentials: {},
      settings: {},
    });
  });

  it('migrates a legacy comma-separated allowFrom string to object-list shape', () => {
    // Operators on the very first cut of allowFrom stored a single string.
    // The new editor is bound to an array — the form would crash on a string
    // unless we lift it into `[{id}]` on read.
    const result = getChannelFormValues({
      settings: { allowFrom: 'alice, bob\n carol' },
    });
    expect(result.settings).toEqual({
      allowFrom: [{ id: 'alice' }, { id: 'bob' }, { id: 'carol' }],
    });
  });

  it('migrates a legacy bare string[] allowFrom into object-list shape', () => {
    const result = getChannelFormValues({
      settings: { groupAllowFrom: ['channel-1', '  channel-2 ', ''] },
    });
    expect(result.settings).toEqual({
      groupAllowFrom: [{ id: 'channel-1' }, { id: 'channel-2' }],
    });
  });

  it('passes through the new object-list shape unchanged (preserves names)', () => {
    const result = getChannelFormValues({
      settings: {
        allowFrom: [{ id: 'alice', name: 'Alice — PM' }, { id: 'bob' }],
      },
    });
    expect(result.settings).toEqual({
      allowFrom: [{ id: 'alice', name: 'Alice — PM' }, { id: 'bob' }],
    });
  });

  it('drops object entries with empty / missing ids during migration', () => {
    const result = getChannelFormValues({
      settings: {
        allowFrom: [{ id: '' }, { id: '   ' }, { id: 'bob', name: 'Bob' }],
      },
    });
    expect(result.settings).toEqual({ allowFrom: [{ id: 'bob', name: 'Bob' }] });
  });
});

describe('extractSettingsDefaults', () => {
  it('returns empty object when schema is undefined or has no settings section', () => {
    expect(extractSettingsDefaults(undefined)).toEqual({});
    expect(extractSettingsDefaults([])).toEqual({});
  });

  it('extracts top-level default values and skips fields without a default', () => {
    expect(extractSettingsDefaults(slackSchema)).toEqual({
      charLimit: 4000,
      concurrency: 'queue',
      connectionMode: 'websocket',
    });
  });
});

describe('mergeCredentialsForSave', () => {
  it('carries a credential key the form does not mention', () => {
    // The persisted copy keeps every key, but a form that never registered a
    // field for one of them would drop it — the server replaces the blob
    // wholesale, so the carried mask is what stops the key being deleted.
    expect(
      mergeCredentialsForSave(
        { botId: '••••••••', botToken: '••••••••' },
        { botToken: '••••••••' },
      ),
    ).toEqual({ botId: '••••••••', botToken: '••••••••' });
  });

  it('lets a form edit win over the config value', () => {
    expect(mergeCredentialsForSave({ botToken: '••••••••' }, { botToken: 'rotated' })).toEqual({
      botToken: 'rotated',
    });
  });

  it('keeps clearing a credential meaningful', () => {
    // An explicit empty overrides the carried value and is then dropped, so the
    // server deletes the key instead of silently resurrecting it.
    expect(mergeCredentialsForSave({ botToken: '••••••••' }, { botToken: '' })).toEqual({});
  });

  it('drops undefined values and tolerates a missing config', () => {
    expect(mergeCredentialsForSave(undefined, { botToken: undefined } as never)).toEqual({});
  });
});

describe('shouldAdoptIncomingConfig', () => {
  const provider = { id: 'provider-1', platform: 'wechat' };

  it('ignores a same-provider replacement while the form is dirty', () => {
    // The replica-backed background revalidation must not wipe a mid-edit form.
    expect(shouldAdoptIncomingConfig(provider, provider, true)).toBe(false);
  });

  it('adopts a same-provider replacement once the form is clean', () => {
    expect(shouldAdoptIncomingConfig(provider, provider, false)).toBe(true);
  });

  it('adopts a different provider even while the previous form was dirty', () => {
    expect(
      shouldAdoptIncomingConfig(provider, { id: 'provider-2', platform: 'wechat' }, true),
    ).toBe(true);
  });

  it('adopts on the first paint, when there is no previous config', () => {
    expect(shouldAdoptIncomingConfig(undefined, provider, true)).toBe(true);
  });
});

describe('mergeSettingsWithDefaults', () => {
  it('fills in schema defaults for missing keys', () => {
    expect(mergeSettingsWithDefaults(slackSchema, {})).toEqual({
      charLimit: 4000,
      concurrency: 'queue',
      connectionMode: 'websocket',
    });
  });

  it('user-provided values override schema defaults', () => {
    expect(mergeSettingsWithDefaults(slackSchema, { connectionMode: 'webhook' })).toEqual({
      charLimit: 4000,
      concurrency: 'queue',
      connectionMode: 'webhook',
    });
  });

  it('preserves keys not declared in the schema', () => {
    expect(mergeSettingsWithDefaults(slackSchema, { extra: 'keep-me' })).toEqual({
      charLimit: 4000,
      concurrency: 'queue',
      connectionMode: 'websocket',
      extra: 'keep-me',
    });
  });
});

describe('bot-wake channel lists', () => {
  it.each([BOT_WAKE_SETTING_KEYS.allowChannels, BOT_WAKE_SETTING_KEYS.denyChannels])(
    'migrates a hand-written %s to the row shape the list editor needs',
    (key) => {
      const { settings } = getChannelFormValues({
        settings: { [key]: ['c1', ' c2 '] },
      }) as { settings: Record<string, unknown> };

      expect(settings[key]).toEqual([{ id: 'c1' }, { id: 'c2' }]);
    },
  );

  it.each([BOT_WAKE_SETTING_KEYS.allowChannels, BOT_WAKE_SETTING_KEYS.denyChannels])(
    'keeps numeric snowflake %s entries a hand-written config may carry',
    (key) => {
      // The runtime parser accepts bare numbers (`parseIdList`), so dropping them here would
      // save an allowlist back as "unrestricted" — or a denylist as "nothing blocked" — just
      // because the operator opened the form.
      const { settings } = getChannelFormValues({
        settings: { [key]: [22, '33', 445566] },
      }) as { settings: Record<string, unknown> };

      expect(settings[key]).toEqual([{ id: '22' }, { id: '33' }, { id: '445566' }]);
    },
  );
});

describe('isFieldReleased', () => {
  it('shows a field that names no rollout flag', () => {
    expect(isFieldReleased({}, undefined)).toBe(true);
    expect(isFieldReleased({}, { enableBotWake: false })).toBe(true);
  });

  it('shows a gated field only when its flag is explicitly on', () => {
    const field = { featureFlag: 'enableBotWake' };

    expect(isFieldReleased(field, { enableBotWake: true })).toBe(true);
    expect(isFieldReleased(field, { enableBotWake: false })).toBe(false);
  });

  it('hides a gated field while the flags are unset or have not loaded', () => {
    const field = { featureFlag: 'enableBotWake' };

    expect(isFieldReleased(field, undefined)).toBe(false);
    expect(isFieldReleased(field, {})).toBe(false);
    expect(isFieldReleased(field, { enableBotWake: undefined })).toBe(false);
    expect(isFieldReleased(field, { enableBotWake: 'yes' })).toBe(false);
  });
});

describe('findOverLimitSettings', () => {
  const listSchema: FieldSchema[] = [
    {
      key: 'settings',
      label: 'Settings',
      properties: [
        {
          key: 'allowChannels',
          label: 'channel.allow',
          maximum: 2,
          type: 'array',
          items: { key: 'item', label: '', type: 'object' },
        },
        {
          key: 'group',
          label: '',
          properties: [
            {
              key: 'denyChannels',
              label: 'channel.deny',
              maximum: 2,
              type: 'array',
              items: { key: 'item', label: '', type: 'object' },
            },
          ],
          type: 'object',
        },
        {
          key: 'keywords',
          label: 'channel.keywords',
          type: 'array',
          items: { key: 'item', label: '', type: 'string' },
        },
      ],
      type: 'object',
    },
  ];

  it('returns nothing while every list stays within its cap', () => {
    expect(
      findOverLimitSettings(listSchema, {
        allowChannels: [{ id: '1' }, { id: '2' }],
        denyChannels: [{ id: '3' }],
      }),
    ).toEqual([]);
  });

  it('reports the field, the real entry count and the cap once a list overflows', () => {
    expect(
      findOverLimitSettings(listSchema, {
        allowChannels: [{ id: '1' }, { id: '2' }, { id: '3' }],
      }),
    ).toEqual([{ count: 3, key: 'allowChannels', max: 2 }]);
  });

  it('reaches list fields nested in a settings group', () => {
    expect(
      findOverLimitSettings(listSchema, {
        denyChannels: [{ id: '1' }, { id: '2' }, { id: '3' }],
      }),
    ).toEqual([{ count: 3, key: 'denyChannels', max: 2 }]);
  });

  it('ignores blank rows and lists whose schema declares no cap', () => {
    expect(
      findOverLimitSettings(listSchema, {
        allowChannels: [{ id: '1' }, { id: '2' }, { id: '' }, { id: '   ' }],
        keywords: ['a', 'b', 'c', 'd'],
      }),
    ).toEqual([]);
  });

  it('ignores values that are not lists at all', () => {
    expect(findOverLimitSettings(listSchema, { allowChannels: '1,2,3' })).toEqual([]);
    expect(findOverLimitSettings(undefined, { allowChannels: [{ id: '1' }] })).toEqual([]);
  });
});

describe('bot-wake master switch', () => {
  const schema = [
    {
      key: 'settings',
      label: 'settings',
      properties: [
        {
          default: false,
          featureFlag: 'enableBotWake',
          key: 'botWakeEnabled',
          label: 'x',
          type: 'boolean',
        },
        { key: 'charLimit', label: 'y', type: 'number' },
      ],
      type: 'object',
    },
  ] as FieldSchema[];

  it('is released only when the rollout flag is on', () => {
    expect(isWakeMasterReleased(schema, { enableBotWake: true })).toBe(true);
    expect(isWakeMasterReleased(schema, { enableBotWake: false })).toBe(false);
    expect(isWakeMasterReleased(schema, undefined)).toBe(false);
    expect(isWakeMasterReleased([], { enableBotWake: true })).toBe(false);
  });

  it('is switched on in the form for a released user, whatever was stored', () => {
    expect(withWakeMasterOn({ botWakeEnabled: false, charLimit: 2000 }, true)).toEqual({
      botWakeEnabled: true,
      charLimit: 2000,
    });
  });

  it('is left alone for everyone else, so saving a bot never switches the options on for them', () => {
    const settings = { botWakeEnabled: false };

    expect(withWakeMasterOn(settings, false)).toBe(settings);
  });
});
