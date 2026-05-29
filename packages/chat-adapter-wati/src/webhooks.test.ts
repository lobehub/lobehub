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
          channelPhoneNumber: '852-5333-2683',
          url: 'https://abc.ngrok.app/api/agent/webhooks/wati/85253332683/',
        },
      ],
      '85253332683',
      'https://abc.ngrok.app/api/agent/webhooks/wati/85253332683',
    );

    expect(match?.channelPhoneNumber).toBe('852-5333-2683');
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
