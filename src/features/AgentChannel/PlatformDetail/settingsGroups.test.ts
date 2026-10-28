import { describe, expect, it } from 'vitest';

import { BOT_WAKE_SETTING_KEYS } from '@/server/services/agentSignal/scenarios/botWake/config';
import { botWakeFields } from '@/server/services/bot/platforms/botWakeFields';
import type { FieldSchema } from '@/server/services/bot/platforms/types';

import {
  getSchemaFields,
  groupAccessFields,
  groupSettingsFields,
  groupWakeFields,
} from './settingsGroups';

const field = (key: string): FieldSchema => ({ key, label: key, type: 'string' });

describe('groupAccessFields', () => {
  it('splits access into owner identity, conversation and device blocks, in page order', () => {
    const sections = groupAccessFields(
      ['deviceAllowFrom', 'groupPolicy', 'userId', 'devicePolicy', 'dmPolicy', 'serverId'].map(
        field,
      ),
    );

    expect(sections.map((s) => [s.key, s.fields.map((f) => f.key)])).toEqual([
      ['identity', ['userId', 'serverId']],
      ['conversation', ['dmPolicy', 'groupPolicy']],
      ['device', ['devicePolicy', 'deviceAllowFrom']],
    ]);
  });

  it('drops a block the platform has no fields for', () => {
    expect(groupAccessFields(['userId', 'devicePolicy'].map(field)).map((s) => s.key)).toEqual([
      'identity',
      'device',
    ]);
  });
});

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
        'botWakeScope',
        'dmPolicy',
        'watchKeywords',
      ].map(field),
    );

    expect(groups.map((g) => [g.key, g.fields.map((f) => f.key)])).toEqual([
      ['access', ['dmPolicy']],
      ['wake', ['watchKeywords', 'botWakeEnabled', 'botWakeScope']],
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

describe('groupWakeFields', () => {
  const K = BOT_WAKE_SETTING_KEYS;
  const keysOf = (fields: FieldSchema[]) =>
    groupWakeFields(fields).map((section) => [section.key, section.fields.map((f) => f.key)]);

  it('splits the wake options into judgement, keywords, channels and pace, in that order', () => {
    // Deliberately shuffled: the sections decide the order, not the schema.
    const fields = [
      K.customInstructions,
      K.cooldownSeconds,
      'watchKeywords',
      K.denyChannels,
      K.classifierThreshold,
      K.windowSeconds,
      K.scope,
      K.collectSeconds,
      K.allowChannels,
      K.schedulerMode,
      K.maxSilentWakes,
      K.ownerPresenceSeconds,
    ].map(field);

    expect(keysOf(fields)).toEqual([
      ['judgement', [K.customInstructions]],
      ['keywords', ['watchKeywords']],
      ['channels', [K.scope, K.allowChannels, K.denyChannels]],
      [
        'pace',
        [
          K.windowSeconds,
          K.classifierThreshold,
          K.maxSilentWakes,
          K.ownerPresenceSeconds,
          K.schedulerMode,
          K.collectSeconds,
          K.cooldownSeconds,
        ],
      ],
    ]);
  });

  it('opens with the duties and their dial, then the instructions, each switch above its text', () => {
    const section = groupWakeFields(
      [K.customInstructions, K.dutiesThreshold, K.customInstructionsEnabled, K.duties].map(field),
    ).find((s) => s.key === 'judgement')!;

    expect(section.fields.map((f) => f.key)).toEqual([
      K.duties,
      K.dutiesThreshold,
      K.customInstructionsEnabled,
      K.customInstructions,
    ]);
  });

  it('shows the shipped schema the duties first, and nothing of help-me or help-others', () => {
    const sections = groupWakeFields(botWakeFields);
    const keys = sections.flatMap((section) => section.fields.map((f) => f.key));

    expect(sections.map((section) => section.key)).toEqual(['judgement', 'channels', 'pace']);
    expect(sections[0].fields.map((f) => f.key)).toEqual([
      K.duties,
      K.dutiesThreshold,
      K.customInstructionsEnabled,
      K.customInstructions,
    ]);
    expect(keys.filter((key) => /Proactive|Initiate/.test(key))).toEqual([]);
  });

  it('shows only the keywords until the rollout reaches the user', () => {
    expect(keysOf(['watchKeywords'].map(field))).toEqual([['keywords', ['watchKeywords']]]);
  });

  it('keeps a bot-wake option it does not know in a section of its own, so nothing disappears', () => {
    expect(keysOf([K.scope, 'botWakeSomethingNew'].map(field))).toEqual([
      ['channels', [K.scope]],
      ['more', ['botWakeSomethingNew']],
    ]);
  });

  it('places every option the runtime reads, apart from the hidden master switch', () => {
    const placed = groupWakeFields(Object.values(K).map(field)).flatMap((section) =>
      section.fields.map((f) => f.key),
    );

    expect(placed.sort()).toEqual(
      Object.values(K)
        .filter((key) => key !== K.enabled)
        .sort(),
    );
  });
});
