import { Webhook } from 'standardwebhooks';
import { describe, expect, it, vi } from 'vitest';

import {
  createInMemoryLinqWebhookDedupeStore,
  LinqWebhookDeduplicator,
  signLinqWebhookPayload,
  verifyLinqWebhookRequest,
  verifyLinqWebhookSignature,
} from './webhook';

/**
 * Standard Webhooks secrets are `whsec_<base64>`; the reference implementation
 * (and therefore Linq) base64-decodes everything after the prefix.
 */
const encodeSecret = (raw: string) => `whsec_${Buffer.from(raw).toString('base64')}`;

const SECRET = encodeSecret('lobe-linq-webhook-test-secret');

const BODY = JSON.stringify({
  data: {
    chat: { id: 'chat-1', is_group: false },
    direction: 'inbound',
    id: 'msg-1',
    parts: [{ type: 'text', value: 'hello' }],
    sender_handle: { handle: '+15550000002' },
  },
  event_type: 'message.received',
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

const sign = (params: { body: string; id: string; secret?: string; timestamp: number | string }) =>
  signLinqWebhookPayload({ secret: SECRET, ...params });

const buildRequest = (params: {
  body: string;
  headers?: Record<string, string>;
  method?: string;
}): Request =>
  new Request('https://app.lobehub.com/api/webhooks/messenger/linq', {
    body: params.method === 'GET' ? undefined : params.body,
    headers: params.headers,
    method: params.method ?? 'POST',
  });

describe('verifyLinqWebhookSignature', () => {
  it('accepts a correctly signed delivery', () => {
    const id = 'wh_1';
    const timestamp = nowSeconds();

    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: {
          id,
          signature: sign({ body: BODY, id, timestamp }),
          timestamp: String(timestamp),
        },
        secret: SECRET,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a tampered body', () => {
    const id = 'wh_tamper';
    const timestamp = nowSeconds();
    const signature = sign({ body: BODY, id, timestamp });

    expect(
      verifyLinqWebhookSignature({
        body: `${BODY} `,
        headers: { id, signature, timestamp: String(timestamp) },
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  it('rejects a signature made with another secret', () => {
    const id = 'wh_other_secret';
    const timestamp = nowSeconds();
    const signature = sign({
      body: BODY,
      id,
      secret: encodeSecret('some-other-secret'),
      timestamp,
    });

    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: { id, signature, timestamp: String(timestamp) },
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  it('enforces the 5 minute tolerance window', () => {
    const id = 'wh_window';
    const base = 1_700_000_000;
    const now = base * 1000;

    const okAt300 = sign({ body: BODY, id, timestamp: base - 300 });
    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: { id, signature: okAt300, timestamp: String(base - 300) },
        now,
        secret: SECRET,
      }),
    ).toEqual({ ok: true });

    const staleAt301 = sign({ body: BODY, id, timestamp: base - 301 });
    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: { id, signature: staleAt301, timestamp: String(base - 301) },
        now,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'timestamp-out-of-tolerance' });

    // A delivery from the future is just as untrustworthy as a stale one.
    const future = sign({ body: BODY, id, timestamp: base + 4000 });
    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: { id, signature: future, timestamp: String(base + 4000) },
        now,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'timestamp-out-of-tolerance' });
  });

  it('requires all three Standard Webhooks headers', () => {
    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: { id: '', signature: 'v1,x', timestamp: '1' },
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'missing-headers' });
  });

  it('accepts one valid entry among several (key rotation) and ignores other versions', () => {
    const id = 'wh_rotate';
    const timestamp = nowSeconds();
    const valid = sign({ body: BODY, id, timestamp });

    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: {
          id,
          signature: `v0,not-a-real-signature v1,${Buffer.from('nope').toString('base64')} ${valid}`,
          timestamp: String(timestamp),
        },
        secret: SECRET,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts a bare base64 secret without the whsec_ prefix', () => {
    const id = 'wh_bare';
    const timestamp = nowSeconds();
    const bare = Buffer.from('lobe-linq-webhook-test-secret').toString('base64');
    const signature = signLinqWebhookPayload({ body: BODY, id, secret: bare, timestamp });

    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: { id, signature, timestamp: String(timestamp) },
        secret: bare,
      }),
    ).toEqual({ ok: true });
  });

  // The whole point of reusing the official adapter is that our gate and Linq
  // agree on the wire format. `standardwebhooks` is the reference
  // implementation the official adapter (and @linqapp/sdk) delegate to.
  it('agrees with the standardwebhooks reference implementation in both directions', () => {
    const reference = new Webhook(SECRET);
    const id = 'wh_cross';
    const timestamp = nowSeconds();
    const headers = { 'webhook-id': id, 'webhook-timestamp': String(timestamp) };

    const ours = sign({ body: BODY, id, timestamp });

    // Ours is accepted by the reference implementation...
    expect(reference.verify(BODY, { ...headers, 'webhook-signature': ours })).toEqual(
      JSON.parse(BODY),
    );

    // ...and theirs is accepted by ours.
    const theirs = reference.sign(id, new Date(timestamp * 1000), BODY);
    expect(
      verifyLinqWebhookSignature({
        body: BODY,
        headers: { id, signature: theirs, timestamp: String(timestamp) },
        secret: SECRET,
      }),
    ).toEqual({ ok: true });
  });
});

describe('LinqWebhookDeduplicator', () => {
  it('claims a webhook-id exactly once', async () => {
    const deduplicator = new LinqWebhookDeduplicator();

    expect(await deduplicator.isDuplicate('wh_a')).toBe(false);
    expect(await deduplicator.isDuplicate('wh_a')).toBe(true);
    expect(await deduplicator.isDuplicate('wh_b')).toBe(false);
  });

  it('releases a claim once its TTL expires', async () => {
    let now = 1_000_000;
    const store = createInMemoryLinqWebhookDedupeStore({ now: () => now });
    const deduplicator = new LinqWebhookDeduplicator(store, 60);

    expect(await deduplicator.isDuplicate('wh_ttl')).toBe(false);
    now += 61_000;
    expect(await deduplicator.isDuplicate('wh_ttl')).toBe(false);
  });

  it('bounds the number of tracked ids', async () => {
    const store = createInMemoryLinqWebhookDedupeStore({ maxEntries: 2 });

    expect(await store.claim('a', 60)).toBe(true);
    expect(await store.claim('b', 60)).toBe(true);
    expect(await store.claim('c', 60)).toBe(true);

    // `a` was evicted when the cap was reached, so it can be claimed again.
    expect(await store.claim('a', 60)).toBe(true);
    expect(await store.claim('c', 60)).toBe(false);
  });
});

describe('verifyLinqWebhookRequest', () => {
  const buildValid = (params: { id?: string; body?: string } = {}) => {
    const id = params.id ?? 'wh_gate';
    const body = params.body ?? BODY;
    const timestamp = nowSeconds();
    return {
      body,
      id,
      request: buildRequest({
        body,
        headers: {
          'webhook-id': id,
          'webhook-signature': sign({ body, id, timestamp }),
          'webhook-timestamp': String(timestamp),
        },
      }),
    };
  };

  it('returns the parsed event for a valid delivery', async () => {
    const { id, request } = buildValid();

    const result = await verifyLinqWebhookRequest(request, { signingSecret: SECRET });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe(id);
      expect(result.event.event_type).toBe('message.received');
    }
  });

  it('answers 503 when the signing secret is not configured', async () => {
    const { request } = buildValid();

    const result = await verifyLinqWebhookRequest(request, { signingSecret: undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it('answers 401 for an unsigned delivery', async () => {
    const result = await verifyLinqWebhookRequest(buildRequest({ body: BODY }), {
      signingSecret: SECRET,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('answers 409 for a replayed webhook-id', async () => {
    const deduplicator = new LinqWebhookDeduplicator();

    // Linq retries deliver a fresh Request with the same webhook-id and body.
    const first = await verifyLinqWebhookRequest(buildValid({ id: 'wh_replay' }).request, {
      deduplicator,
      signingSecret: SECRET,
    });
    const second = await verifyLinqWebhookRequest(buildValid({ id: 'wh_replay' }).request, {
      deduplicator,
      signingSecret: SECRET,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.response.status).toBe(409);
  });

  // Security property: an attacker who can post to the endpoint must not be
  // able to burn a webhook-id and suppress Linq's genuine delivery of it.
  it('verifies the signature before touching the dedupe store', async () => {
    const deduplicator = new LinqWebhookDeduplicator();
    const id = 'wh_ordering';
    const forged = buildRequest({
      body: BODY,
      headers: {
        'webhook-id': id,
        'webhook-signature': 'v1,Zm9yZ2Vk',
        'webhook-timestamp': String(nowSeconds()),
      },
    });

    const forgedResult = await verifyLinqWebhookRequest(forged, {
      deduplicator,
      signingSecret: SECRET,
    });
    expect(forgedResult.ok).toBe(false);

    const { request } = buildValid({ id });
    const genuine = await verifyLinqWebhookRequest(request, {
      deduplicator,
      signingSecret: SECRET,
    });
    expect(genuine.ok).toBe(true);
  });

  it('answers 400 for a signed but malformed body', async () => {
    const id = 'wh_bad_json';
    const body = '{not json';
    const timestamp = nowSeconds();
    const request = buildRequest({
      body,
      headers: {
        'webhook-id': id,
        'webhook-signature': sign({ body, id, timestamp }),
        'webhook-timestamp': String(timestamp),
      },
    });

    const result = await verifyLinqWebhookRequest(request, { signingSecret: SECRET });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it('accepts a caller-buffered raw body without re-reading the request', async () => {
    const { request } = buildValid({ id: 'wh_buffered' });
    const text = vi.spyOn(request, 'text');

    const result = await verifyLinqWebhookRequest(request, {
      rawBody: BODY,
      signingSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    expect(text).not.toHaveBeenCalled();
  });
});
