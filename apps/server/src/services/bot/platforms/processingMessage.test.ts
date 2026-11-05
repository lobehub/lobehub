import { describe, expect, it } from 'vitest';

import { processingMessageField, shouldPostProcessingMessage } from './const';
import { schema as discordSchema } from './discord/schema';
import { sharedSchema as feishuSchema } from './feishu/definitions/schema';
import { schema as imessageSchema } from './imessage/schema';
import { schema as lineSchema } from './line/schema';
import { schema as qqSchema } from './qq/schema';
import { schema as slackSchema } from './slack/schema';
import { schema as telegramSchema } from './telegram/schema';
import type { FieldSchema } from './types';
import { schema as wechatSchema } from './wechat/schema';

describe('shouldPostProcessingMessage', () => {
  it('skips the message for rows saved before the field existed', () => {
    expect(shouldPostProcessingMessage(undefined)).toBe(false);
    expect(shouldPostProcessingMessage({})).toBe(false);
  });

  it('posts the message only on an explicit true', () => {
    expect(shouldPostProcessingMessage({ processingMessage: true })).toBe(true);
    expect(shouldPostProcessingMessage({ processingMessage: false })).toBe(false);
    expect(shouldPostProcessingMessage({ processingMessage: 'true' })).toBe(false);
  });
});

describe('processingMessageField', () => {
  it('defaults to off', () => {
    expect(processingMessageField.default).toBe(false);
  });

  it.each([
    ['discord', discordSchema],
    ['feishu', feishuSchema],
    ['imessage', imessageSchema],
    ['line', lineSchema],
    ['qq', qqSchema],
    ['slack', slackSchema],
    ['telegram', telegramSchema],
    ['wechat', wechatSchema],
  ])('is exposed in the %s settings', (_platform, schema: FieldSchema[]) => {
    const settings = schema.find((field) => field.key === 'settings');
    expect(settings?.properties?.some((field) => field.key === 'processingMessage')).toBe(true);
  });
});
