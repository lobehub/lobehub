import { describe, expect, it } from 'vitest';

import { validateAccessSettings } from '../const';
import type { FieldSchema } from '../types';
import { mergeWithDefaults } from '../utils';
import { collectFieldFormatViolations } from '../validateFieldFormats';
import { DINGTALK_CHAR_LIMIT } from './const';
import { schema } from './schema';

const section = (key: string): FieldSchema | undefined => schema.find((f) => f.key === key);
const settingKeys = () => section('settings')?.properties?.map((f) => f.key) ?? [];

describe('DingTalk schema', () => {
  it('takes the Client ID as the application id', () => {
    expect(section('applicationId')).toMatchObject({
      label: 'channel.dingtalk.clientId',
      required: true,
      type: 'string',
    });
  });

  it('stores Client Secret as the only secret and RobotCode as an optional identifier', () => {
    const credentials = section('credentials')?.properties ?? [];
    expect(credentials.map((f) => [f.key, f.type, !!f.required])).toEqual([
      ['clientSecret', 'password', true],
      ['robotCode', 'string', false],
    ]);
  });

  it('reuses the shared access, reply and concurrency fields', () => {
    expect(settingKeys()).toEqual(
      expect.arrayContaining([
        'userId',
        'connectionMode',
        'charLimit',
        'concurrency',
        'debounceMs',
        'showUsageStats',
        'displayToolCalls',
        'processingMessage',
        'dmPolicy',
        'groupPolicy',
        'groupAllowFrom',
        'allowFrom',
        'watchKeywords',
        'replyStyle',
      ]),
    );
  });

  it('does not offer a reaction mode, since DingTalk robots cannot react', () => {
    expect(settingKeys()).not.toContain('reactionMode');
  });

  it('defaults to Stream mode, open policies and the byte-safe char limit', () => {
    const defaults = mergeWithDefaults(schema, {});
    expect(defaults).toMatchObject({
      charLimit: DINGTALK_CHAR_LIMIT,
      connectionMode: 'websocket',
      dmPolicy: 'open',
      groupPolicy: 'open',
      processingMessage: false,
    });
  });

  it('rejects malformed identifiers through the shared format check', () => {
    expect(
      collectFieldFormatViolations(schema, {
        applicationId: 'ding abc',
        credentials: { clientSecret: 'any secret / value', robotCode: 'https://x' },
      }).map((v) => v.field),
    ).toEqual(['applicationId', 'credentials.robotCode']);

    expect(
      collectFieldFormatViolations(schema, {
        applicationId: 'dingabc123',
        credentials: { clientSecret: 'S3cr3t+/=', robotCode: '' },
      }),
    ).toEqual([]);
  });

  it('runs the shared access-settings validation', () => {
    expect(validateAccessSettings({ dmPolicy: 'pairing' }).valid).toBe(false);
    expect(validateAccessSettings({ dmPolicy: 'pairing', userId: 'manager1234' }).valid).toBe(true);
    expect(validateAccessSettings(mergeWithDefaults(schema, {})).valid).toBe(true);
  });
});
