import { describe, expect, it } from 'vitest';

import type { FieldSchema } from '@/server/services/bot/platforms/types';

import { getSchemaFields, groupSettingsFields } from './settingsGroups';

const field = (key: string): FieldSchema => ({ key, label: key, type: 'string' });

describe('groupSettingsFields', () => {
  it('sorts fields into connect, access, reply and advanced, ordered by how a person decides them', () => {
    const groups = groupSettingsFields(
      [
        'serverId',
        'charLimit',
        'groupPolicy',
        'watchKeywords',
        'allowFrom',
        'dmPolicy',
        'userId',
        'displayToolCalls',
        'reactionMode',
        'historyLimit',
      ].map(field),
    );

    expect(groups.map((g) => [g.key, g.fields.map((f) => f.key)])).toEqual([
      ['access', ['userId', 'serverId', 'dmPolicy', 'allowFrom', 'groupPolicy']],
      ['wake', ['watchKeywords']],
      ['reply', ['displayToolCalls', 'reactionMode']],
      ['advanced', ['charLimit', 'historyLimit']],
    ]);
  });

  it('keeps a field it does not know in advanced, in schema order, so nothing disappears', () => {
    const groups = groupSettingsFields(['mysterySetting', 'dmPolicy', 'someNewSetting'].map(field));

    expect(groups.find((g) => g.key === 'advanced')?.fields.map((f) => f.key)).toEqual([
      'mysterySetting',
      'someNewSetting',
    ]);
  });

  it('puts how the bot reaches the platform with the connection, and your server with your own ID', () => {
    const groups = groupSettingsFields(
      ['charLimit', 'connectionMode', 'serverId', 'userId'].map(field),
    );

    expect(groups.find((g) => g.key === 'connect')?.fields.map((f) => f.key)).toEqual([
      'connectionMode',
    ]);
    expect(groups.find((g) => g.key === 'access')?.fields.map((f) => f.key)).toEqual([
      'userId',
      'serverId',
    ]);
    expect(groups.find((g) => g.key === 'advanced')?.fields.map((f) => f.key)).toEqual([
      'charLimit',
    ]);
  });

  it('puts the watch keywords and the bot-wake options in one group between access and replies', () => {
    const groups = groupSettingsFields(
      [
        'charLimit',
        'botWakeEnabled',
        'displayToolCalls',
        'botWakeMode',
        'dmPolicy',
        'watchKeywords',
      ].map(field),
    );

    expect(groups.map((g) => [g.key, g.fields.map((f) => f.key)])).toEqual([
      ['access', ['dmPolicy']],
      ['wake', ['watchKeywords', 'botWakeEnabled', 'botWakeMode']],
      ['reply', ['displayToolCalls']],
      ['advanced', ['charLimit']],
    ]);
  });

  it('drops sections a platform has no fields for', () => {
    const groups = groupSettingsFields(['displayToolCalls', 'reactionMode'].map(field));

    expect(groups.map((g) => g.key)).toEqual(['reply']);
  });

  it('returns nothing for a platform without settings', () => {
    expect(groupSettingsFields([])).toEqual([]);
  });
});

describe('getSchemaFields', () => {
  const schema: FieldSchema[] = [
    {
      key: 'settings',
      label: 'settings',
      properties: [
        field('charLimit'),
        { ...field('botWakeEnabled'), featureFlag: 'enableBotWake' },
      ],
      type: 'object',
    },
  ];

  it('hides a field behind a rollout flag until the flag is on', () => {
    expect(getSchemaFields(schema, 'settings').map((f) => f.key)).toEqual(['charLimit']);
    expect(getSchemaFields(schema, 'settings', { enableBotWake: false }).map((f) => f.key)).toEqual(
      ['charLimit'],
    );
    expect(getSchemaFields(schema, 'settings', { enableBotWake: true }).map((f) => f.key)).toEqual([
      'charLimit',
      'botWakeEnabled',
    ]);
  });
});
