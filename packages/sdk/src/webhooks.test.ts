import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { WebhookEventData } from './index';
import {
  constructWebhookEvent,
  verifyWebhookSignature,
  WEBHOOK_EVENT_TYPES,
  WebhookSignatureVerificationError,
} from './index';

const SECRET = 'whsec_test_secret_value';
const NOW = new Date('2026-11-18T08:00:00.000Z');
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);

const PAYLOAD = JSON.stringify({
  createdAt: NOW.toISOString(),
  data: { agentId: 'agt_1', assistantMessageId: 'msg_1', runId: 'op_1', steps: 3, topicId: null },
  id: 'evt_1',
  type: 'run.completed',
  workspaceId: null,
});

/** What the LobeHub server sends: `v1=<hex HMAC-SHA256(secret, "<ts>.<body>")>`. */
const sign = (body: string, timestamp = TIMESTAMP, secret = SECRET) =>
  `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

const headersFor = (signature: string, timestamp: number | string = TIMESTAMP) => ({
  'x-lobehub-signature': signature,
  'x-lobehub-timestamp': String(timestamp),
});

const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (error_: unknown) => error_,
  );
  expect(error).toBeInstanceOf(WebhookSignatureVerificationError);
  return (error as WebhookSignatureVerificationError).code;
};

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature from Node-style headers', async () => {
    await expect(
      verifyWebhookSignature({
        headers: headersFor(sign(PAYLOAD)),
        now: NOW,
        payload: PAYLOAD,
        secret: SECRET,
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts a Fetch Headers object, explicit values and a byte payload', async () => {
    const headers = new Headers({
      'X-LobeHub-Signature': sign(PAYLOAD),
      'X-LobeHub-Timestamp': String(TIMESTAMP),
    });
    await verifyWebhookSignature({ headers, now: NOW, payload: PAYLOAD, secret: SECRET });
    await verifyWebhookSignature({
      now: NOW,
      payload: new TextEncoder().encode(PAYLOAD),
      secret: SECRET,
      signature: sign(PAYLOAD),
      timestamp: TIMESTAMP,
    });
  });

  it('rejects a tampered body', async () => {
    const tampered = PAYLOAD.replace('"steps":3', '"steps":4');
    expect(
      await rejection(
        verifyWebhookSignature({
          headers: headersFor(sign(PAYLOAD)),
          now: NOW,
          payload: tampered,
          secret: SECRET,
        }),
      ),
    ).toBe('signature_mismatch');
  });

  it('rejects a signature made with another secret', async () => {
    expect(
      await rejection(
        verifyWebhookSignature({
          headers: headersFor(sign(PAYLOAD, TIMESTAMP, 'whsec_other')),
          now: NOW,
          payload: PAYLOAD,
          secret: SECRET,
        }),
      ),
    ).toBe('signature_mismatch');
  });

  it('rejects a timestamp swapped after signing', async () => {
    expect(
      await rejection(
        verifyWebhookSignature({
          headers: headersFor(sign(PAYLOAD), TIMESTAMP + 1),
          now: NOW,
          payload: PAYLOAD,
          secret: SECRET,
        }),
      ),
    ).toBe('signature_mismatch');
  });

  it('rejects an expired timestamp and a future one, and honours toleranceSeconds', async () => {
    const old = TIMESTAMP - 301;
    expect(
      await rejection(
        verifyWebhookSignature({
          headers: headersFor(sign(PAYLOAD, old), old),
          now: NOW,
          payload: PAYLOAD,
          secret: SECRET,
        }),
      ),
    ).toBe('timestamp_out_of_range');

    const future = TIMESTAMP + 301;
    expect(
      await rejection(
        verifyWebhookSignature({
          headers: headersFor(sign(PAYLOAD, future), future),
          now: NOW,
          payload: PAYLOAD,
          secret: SECRET,
        }),
      ),
    ).toBe('timestamp_out_of_range');

    await verifyWebhookSignature({
      headers: headersFor(sign(PAYLOAD, old), old),
      now: NOW,
      payload: PAYLOAD,
      secret: SECRET,
      toleranceSeconds: 600,
    });
  });

  it('accepts any matching v1 entry among several, separated by commas or spaces', async () => {
    const valid = sign(PAYLOAD);
    const stale = sign(PAYLOAD, TIMESTAMP, 'whsec_rotated_out');
    for (const header of [`${stale},${valid}`, `${stale} ${valid}`, `${valid}, ${stale}`]) {
      await verifyWebhookSignature({
        headers: headersFor(header),
        now: NOW,
        payload: PAYLOAD,
        secret: SECRET,
      });
    }
    expect(
      await rejection(
        verifyWebhookSignature({
          headers: headersFor(`${stale} v0=${valid.slice(3)}`),
          now: NOW,
          payload: PAYLOAD,
          secret: SECRET,
        }),
      ),
    ).toBe('signature_mismatch');
  });

  it('rejects missing headers', async () => {
    expect(
      await rejection(
        verifyWebhookSignature({
          headers: { 'x-lobehub-timestamp': String(TIMESTAMP) },
          now: NOW,
          payload: PAYLOAD,
          secret: SECRET,
        }),
      ),
    ).toBe('missing_signature');
    expect(
      await rejection(
        verifyWebhookSignature({
          headers: { 'x-lobehub-signature': sign(PAYLOAD) },
          now: NOW,
          payload: PAYLOAD,
          secret: SECRET,
        }),
      ),
    ).toBe('missing_timestamp');
  });
});

describe('constructWebhookEvent', () => {
  it('verifies, then returns the typed event', async () => {
    const event = await constructWebhookEvent({
      headers: headersFor(sign(PAYLOAD)),
      now: NOW,
      payload: PAYLOAD,
      secret: SECRET,
    });
    expect(event.type).toBe('run.completed');
    if (event.type === 'run.completed') {
      const data: WebhookEventData<'run.completed'> = event.data;
      expect(data.steps).toBe(3);
    }
  });

  it('does not parse a body whose signature fails', async () => {
    expect(
      await rejection(
        constructWebhookEvent({
          headers: headersFor(sign(PAYLOAD)),
          now: NOW,
          payload: `${PAYLOAD} `,
          secret: SECRET,
        }),
      ),
    ).toBe('signature_mismatch');
  });

  it('rejects a signed body that is not JSON', async () => {
    expect(
      await rejection(
        constructWebhookEvent({
          headers: headersFor(sign('not json')),
          now: NOW,
          payload: 'not json',
          secret: SECRET,
        }),
      ),
    ).toBe('invalid_payload');
  });
});

describe('WEBHOOK_EVENT_TYPES', () => {
  it('lists the subscribable events, without the test event', () => {
    expect(WEBHOOK_EVENT_TYPES).toContain('run.completed');
    expect(WEBHOOK_EVENT_TYPES).not.toContain('webhook.test');
  });
});
