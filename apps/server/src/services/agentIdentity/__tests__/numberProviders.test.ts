// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createTwilioSandbox } from '../numbers/sandbox/twilioSandbox';
import { createTelnyxNumberProvider } from '../numbers/telnyx';
import { computeTwilioSignature, createTwilioNumberProvider } from '../numbers/twilio';
import { countSmsSegments } from '../numbers/types';

const ACCOUNT_SID = 'AC00000000000000000000000000000001';
const AUTH_TOKEN = 'sandbox_auth_token';
const WEBHOOK = 'https://app.example.com/api/agent/accounts/webhooks/twilio';

describe('twilio adapter', () => {
  it("signs exactly like Twilio's documented example", () => {
    // https://www.twilio.com/docs/usage/security#validating-requests
    expect(
      computeTwilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
        CallSid: 'CA1234567890ABCDE',
        Caller: '+12349013030',
        Digits: '1234',
        From: '+12349013030',
        To: '+18005551212',
      }),
    ).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  });

  const setup = () => {
    const sandbox = createTwilioSandbox({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      inventory: { '415': ['+14155550101'] },
    });
    const provider = createTwilioNumberProvider({
      accountSid: ACCOUNT_SID,
      apiBaseUrl: 'https://api.twilio.test',
      authToken: AUTH_TOKEN,
      fetch: sandbox.fetch,
      smsWebhookUrl: WEBHOOK,
    });
    return { provider, sandbox };
  };

  it('search → buy → configure → send → release over the REST contract', async () => {
    const { provider, sandbox } = setup();

    const [found] = await provider.search({ areaCode: '415' });
    expect(found).toMatchObject({ capabilities: { sms: true }, phoneNumber: '+14155550101' });

    const bought = await provider.buy(found.phoneNumber, { smsWebhookUrl: WEBHOOK, tag: 'pool' });
    expect(bought.providerNumberId).toMatch(/^PN/);

    await provider.configureWebhook(bought, { smsWebhookUrl: WEBHOOK, tag: 'agent:agt_1' });
    expect(sandbox.state.numbers.get(bought.providerNumberId)).toMatchObject({
      friendlyName: 'agent:agt_1',
      smsUrl: WEBHOOK,
      voiceUrl: `${WEBHOOK}/voice`,
    });

    const sent = await provider.send(bought, { text: 'hi', to: '+15551230000' });
    expect(sent).toMatchObject({ segments: 1 });

    await provider.release(bought);
    // Releasing twice is idempotent: the carrier 404 means it is already gone.
    await expect(provider.release(bought)).resolves.toBeUndefined();
  });

  it('surfaces the test-credential "unavailable" magic number as a carrier error', async () => {
    const { provider } = setup();
    await expect(
      provider.buy('+15005550000', { smsWebhookUrl: WEBHOOK, tag: 'pool' }),
    ).rejects.toThrow(/21422/);
  });

  it('reports no campaign when no 10DLC messaging service is configured', async () => {
    const { provider } = setup();
    await expect(
      provider.messagingEligibility({ phoneNumber: '+1', providerNumberId: 'PN1' }),
    ).resolves.toEqual({ status: 'none' });
  });

  it('verifies the webhook signature against the configured URL and parses the SMS', async () => {
    const { provider, sandbox } = setup();
    const bought = await provider.buy('+14155550101', { smsWebhookUrl: WEBHOOK, tag: 'pool' });
    const delivery = sandbox.buildInbound({
      body: 'Your code is 482913',
      from: '+15557654321',
      to: bought.phoneNumber,
    });

    expect(provider.peekRecipient(delivery.body)).toBe(bought.phoneNumber);
    const parsed = await provider.parseInbound({ body: delivery.body, headers: delivery.headers });
    expect(parsed).toMatchObject({
      message: {
        from: '+15557654321',
        segments: 1,
        text: 'Your code is 482913',
        to: bought.phoneNumber,
      },
      ok: true,
    });

    const tampered = delivery.body.replace('482913', '000000');
    expect(await provider.parseInbound({ body: tampered, headers: delivery.headers })).toEqual({
      ok: false,
    });
  });
});

describe('telnyx adapter', () => {
  const keys = generateKeyPairSync('ed25519');
  const rawPublicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  const NOW = 1_791_100_000_000;

  const provider = createTelnyxNumberProvider({
    apiKey: 'KEY_test',
    fetch: async () => new Response('{}'),
    messagingProfileId: 'mp_1',
    now: () => NOW,
    publicKey: rawPublicKey.toString('base64'),
  });

  const event = JSON.stringify({
    data: {
      event_type: 'message.received',
      id: 'evt_1',
      payload: {
        direction: 'inbound',
        from: { phone_number: '+15557654321' },
        id: 'msg_1',
        parts: 1,
        received_at: '2026-10-05T00:00:00.000Z',
        text: 'code 123456',
        to: [{ phone_number: '+14155550101' }],
      },
    },
  });

  const signed = (body: string, timestamp = String(Math.floor(NOW / 1000))) => ({
    body,
    headers: {
      'telnyx-signature-ed25519': sign(
        null,
        Buffer.from(`${timestamp}|${body}`),
        keys.privateKey,
      ).toString('base64'),
      'telnyx-timestamp': timestamp,
    },
  });

  it('verifies the Ed25519 signature and parses the inbound message', async () => {
    expect(provider.peekRecipient(event)).toBe('+14155550101');
    expect(await provider.parseInbound(signed(event))).toMatchObject({
      message: {
        from: '+15557654321',
        providerMessageId: 'msg_1',
        text: 'code 123456',
        to: '+14155550101',
      },
      ok: true,
    });
  });

  it('rejects a forged body and a stale timestamp', async () => {
    const good = signed(event);
    expect(
      await provider.parseInbound({ ...good, body: event.replace('123456', '999999') }),
    ).toEqual({
      ok: false,
    });
    expect(
      await provider.parseInbound(signed(event, String(Math.floor(NOW / 1000) - 3600))),
    ).toEqual({ ok: false });
  });

  it('acknowledges delivery receipts without producing a message', async () => {
    const receipt = JSON.stringify({ data: { event_type: 'message.finalized', payload: {} } });
    expect(await provider.parseInbound(signed(receipt))).toEqual({ message: null, ok: true });
  });
});

describe('countSmsSegments', () => {
  it('counts GSM-7 and UCS-2 segments the way carriers bill them', () => {
    expect(countSmsSegments('a'.repeat(160))).toBe(1);
    expect(countSmsSegments('a'.repeat(161))).toBe(2);
    expect(countSmsSegments('你'.repeat(70))).toBe(1);
    expect(countSmsSegments('你'.repeat(71))).toBe(2);
  });
});
