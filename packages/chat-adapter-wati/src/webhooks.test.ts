import { describe, expect, it } from 'vitest';

import { findWebhookForPhoneAndUrl, normalizeWebhookUrl, parseWatiJsonBody } from './webhooks';

describe('normalizeWebhookUrl', () => {
  it('strips trailing slashes and normalizes paths', () => {
    expect(normalizeWebhookUrl('https://example.com/hook/')).toBe('https://example.com/hook');
    expect(normalizeWebhookUrl('https://example.com/hook')).toBe('https://example.com/hook');
  });
});

describe('findWebhookForPhoneAndUrl', () => {
  it('matches phone formats and URL variants', () => {
    const match = findWebhookForPhoneAndUrl(
      [
        {
          channelPhoneNumber: '852-9000-0001',
          url: 'https://tunnel.example.test/api/agent/webhooks/wati/85290000001/',
        },
      ],
      '85290000001',
      'https://tunnel.example.test/api/agent/webhooks/wati/85290000001',
    );

    expect(match?.channelPhoneNumber).toBe('852-9000-0001');
  });
});

describe('parseWatiJsonBody', () => {
  it('parses webhook limit errors', () => {
    const body = parseWatiJsonBody(
      '{"ok":false,"error":"Number of Webhooks exceed limitation","isOverWebhookLimit":true}',
    );
    expect(body?.isOverWebhookLimit).toBe(true);
  });
});
