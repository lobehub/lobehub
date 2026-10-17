import { describe, expect, it } from 'vitest';

import type { FieldSchema } from '@/server/services/bot/platforms/types';

import {
  extractSettingsDefaults,
  getChannelFormValues,
  mergeCredentialsForSave,
  mergeSettingsWithDefaults,
  shouldAdoptIncomingConfig,
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
