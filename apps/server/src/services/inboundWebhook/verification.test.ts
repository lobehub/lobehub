// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { receiverTestSecret, signedWebhookHeaders } from './receiverTestUtils';
import { verifyInboundWebhook } from './verification';

const verification = { scheme: 'standard_webhooks' } as const;
const body = '{ "data": { "message": "你好\\n世界", "count": 1 } }\n';
const verify = (headers: Headers, overrides = {}) =>
  verifyInboundWebhook({
    body,
    headers,
    secret: receiverTestSecret,
    verification,
    ...overrides,
  });

describe('Standard Webhooks inbound verification', () => {
  it('verifies the exact original UTF-8 body', () => {
    const headers = signedWebhookHeaders(body);
    expect(verify(headers)).toBe(true);
    expect(verify(headers, { body: JSON.stringify(JSON.parse(body)) })).toBe(false);
    expect(verify(headers, { body: `${body} ` })).toBe(false);
  });

  it('verifies a correctly signed malformed body before the receiver reports invalid JSON', () => {
    const invalidBody = '{invalid';
    expect(verify(signedWebhookHeaders(invalidBody), { body: invalidBody })).toBe(true);
  });

  it('accepts a valid signature among rotation signatures in any position', () => {
    const headers = signedWebhookHeaders(body);
    const valid = headers.get('webhook-signature');
    headers.set('webhook-signature', `v1,invalid ${valid} v1,other`);
    expect(verify(headers)).toBe(true);
    headers.set('webhook-signature', `v1,invalid v1,other ${valid}`);
    expect(verify(headers)).toBe(true);
  });

  it('rejects expired and future timestamps outside the five-minute window', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verify(signedWebhookHeaders(body, { timestamp: now - 301 }))).toBe(false);
    expect(verify(signedWebhookHeaders(body, { timestamp: now + 301 }))).toBe(false);
    expect(verify(signedWebhookHeaders(body, { timestamp: now - 290 }))).toBe(true);
  });

  it('rejects the wrong key, absent keys and unsupported verification schemes', () => {
    const headers = signedWebhookHeaders(body);
    expect(verify(headers, { secret: `whsec_${Buffer.alloc(32, 43).toString('base64')}` })).toBe(
      false,
    );
    expect(verify(headers, { secret: null })).toBe(false);
    expect(verify(headers, { verification: { scheme: 'unsupported' } })).toBe(false);
  });

  it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])(
    'rejects missing %s',
    (name) => {
      const headers = signedWebhookHeaders(body);
      headers.delete(name);
      expect(verify(headers)).toBe(false);
    },
  );

  it('binds signatures to the delivery id and timestamp', () => {
    const headers = signedWebhookHeaders(body);
    headers.set('webhook-id', 'different-delivery');
    expect(verify(headers)).toBe(false);
    const second = signedWebhookHeaders(body);
    second.set('webhook-timestamp', String(Math.floor(Date.now() / 1000) - 1));
    expect(verify(second)).toBe(false);
  });
});
