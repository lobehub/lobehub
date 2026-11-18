import { describe, expect, it } from 'vitest';

import { signWebhookPayload } from '@/server/services/developerWebhook/signature';

import { verifyInboundSignature } from './signature';

const SECRET = 'a'.repeat(40);
const BODY = '{"type":"ping"}';
const NOW = 1_800_000_000_000;
const TS = NOW / 1000;

describe('verifyInboundSignature', () => {
  it('accepts a request signed with the secret inside the window', () => {
    const signature = signWebhookPayload(SECRET, TS - 60, BODY);

    expect(
      verifyInboundSignature({
        body: BODY,
        now: NOW,
        secret: SECRET,
        signature,
        timestamp: String(TS - 60),
      }),
    ).toEqual({ ok: true });
  });

  it('accepts any of several signatures (secret rotation)', () => {
    const signature = `v1=deadbeef ${signWebhookPayload(SECRET, TS, BODY)}`;

    expect(
      verifyInboundSignature({
        body: BODY,
        now: NOW,
        secret: SECRET,
        signature,
        timestamp: String(TS),
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a missing signature or timestamp', () => {
    expect(
      verifyInboundSignature({
        body: BODY,
        now: NOW,
        secret: SECRET,
        signature: null,
        timestamp: String(TS),
      }),
    ).toEqual({ ok: false, reason: 'missing_signature' });
    expect(
      verifyInboundSignature({
        body: BODY,
        now: NOW,
        secret: SECRET,
        signature: 'v1=x',
        timestamp: null,
      }),
    ).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('refuses a timestamp outside the five-minute window (replay)', () => {
    const stale = TS - 301;
    const signature = signWebhookPayload(SECRET, stale, BODY);

    expect(
      verifyInboundSignature({
        body: BODY,
        now: NOW,
        secret: SECRET,
        signature,
        timestamp: String(stale),
      }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('refuses a signature made with another secret or over another body', () => {
    const wrongSecret = signWebhookPayload('b'.repeat(40), TS, BODY);
    const wrongBody = signWebhookPayload(SECRET, TS, '{"type":"message"}');

    for (const signature of [wrongSecret, wrongBody])
      expect(
        verifyInboundSignature({
          body: BODY,
          now: NOW,
          secret: SECRET,
          signature,
          timestamp: String(TS),
        }),
      ).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('refuses a signature whose timestamp was swapped for a fresh one', () => {
    const signature = signWebhookPayload(SECRET, TS - 1000, BODY);

    expect(
      verifyInboundSignature({
        body: BODY,
        now: NOW,
        secret: SECRET,
        signature,
        timestamp: String(TS),
      }),
    ).toEqual({ ok: false, reason: 'invalid_signature' });
  });
});
