import { Hono } from 'hono';
import { Challenge, Credential } from 'mppx';
import { Mppx, stripe } from 'mppx/server';
import { describe, expect, it } from 'vitest';

import { machinePayment, requirePaymentOr } from './machine-payment';
import { withPaymentRejections } from './machine-payment-rejections';

// Drives the real `stripe.charge()` method from mppx. Only the Stripe SDK client
// is faked, so these tests break if upstream changes the errors it throws.

type PaymentIntentStatus = 'canceled' | 'processing' | 'requires_payment_method' | 'succeeded';

const createApp = (status: PaymentIntentStatus, { wrap = true } = {}) => {
  const client = {
    paymentIntents: { create: async () => ({ id: 'pi_test', status }) },
  };
  const method = stripe.charge({
    client: client as any,
    decimals: 2,
    networkId: 'internal',
    paymentMethodTypes: ['card'],
  } as any);

  const mppx = Mppx.create({
    methods: [wrap ? withPaymentRejections(method) : method],
    realm: 'lobehub.test',
    secretKey: 'machine-payment-test-secret-key-at-least-32-bytes',
  });

  const app = new Hono();
  app.get(
    '/search',
    machinePayment({
      methodKey: 'stripe/charge',
      mppx: mppx as any,
      resolvePrice: async () => ({ amount: '1.00', currency: 'usd' }),
    }),
    requirePaymentOr(async (c) => c.json({ error: 'unauthorized' }, 401)),
    (c) => c.json({ ok: true }),
  );
  return app;
};

const pay = async (app: Hono, payload: Record<string, unknown> = { spt: 'spt_test' }) => {
  const challenge = Challenge.fromResponse(await app.request('/search'));
  const credential = Credential.serialize(Credential.from({ challenge, payload }));
  return app.request('/search', { headers: { Authorization: credential } });
};

describe('withPaymentRejections (real stripe.charge)', () => {
  it('delivers a succeeded payment untouched', async () => {
    const res = await pay(createApp('succeeded'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Payment-Receipt')).toBeTruthy();
  });

  it.each(['requires_payment_method', 'canceled'] as const)(
    'answers a %s PaymentIntent with a fresh 402 challenge',
    async (status) => {
      const res = await pay(createApp(status));

      expect(res.status).toBe(402);
      expect(res.headers.get('WWW-Authenticate')).toMatch(/^Payment /);
    },
  );

  it('answers a malformed credential payload with a 402 challenge', async () => {
    // mppx core rejects this against the method schema before `verify` runs,
    // which is why the wrapper carries no pattern for it.
    const res = await pay(createApp('succeeded', { wrap: false }), { wrong: 'shape' });

    expect(res.status).toBe(402);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^Payment /);
  });

  it('keeps a still-processing charge a 500, since paying again could double-charge', async () => {
    const res = await pay(createApp('processing'));

    expect(res.status).toBe(500);
  });

  it('is what turns a declined card from a 500 into a 402', async () => {
    // Pins the upstream behaviour the wrapper exists for: without it, mppx maps
    // Stripe's plain Error to an InternalPaymentError.
    const res = await pay(createApp('requires_payment_method', { wrap: false }));

    expect(res.status).toBe(500);
  });
});
