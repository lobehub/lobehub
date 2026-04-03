import { describe, expect, it } from 'vitest';

import { dingtalk } from './definition';

function flattenKeys() {
  return dingtalk.schema.flatMap((section) =>
    section.properties?.map((field) => `${section.key}.${field.key}`) ?? [section.key],
  );
}

describe('dingtalk definition', () => {
  it('exposes a webhook platform with manual webhook setup', () => {
    expect(dingtalk.id).toBe('dingtalk');
    expect(dingtalk.name).toBe('DingTalk');
    expect(dingtalk.showWebhookUrl).toBe(true);
    expect(dingtalk.documentation?.setupGuideUrl).toBe(
      'https://lobehub.com/docs/usage/channels/dingtalk',
    );
  });

  it('includes the MVP credentials and settings fields', () => {
    const requiredFields = [
      'applicationId',
      'credentials.clientSecret',
      'credentials.verificationToken',
      'credentials.aesKey',
      'settings.messageType',
      'settings.charLimit',
      'settings.showUsageStats',
    ];

    const keys = flattenKeys();
    requiredFields.forEach((field) => {
      expect(keys).toContain(field);
    });
  });
});
