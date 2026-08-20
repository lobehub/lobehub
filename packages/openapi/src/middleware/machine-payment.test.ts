import { createHmac } from 'node:crypto';

import type { MachinePaymentRecordParams } from '@lobechat/business-server/machine-payments/types';
import { Hono, type MiddlewareHandler } from 'hono';
import { Challenge, Credential, Method, Store, z } from 'mppx';
import { Mppx } from 'mppx/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { machinePayment, requirePaymentOr } from './machine-payment';

// ---------------------------------------------------------------------------
// Fixture: a self-contained payment rail
//
// "Settlement" is an HMAC over the challenge id, which is obviously not a
// payment — it has the same *shape* as one, so the challenge / credential /
// receipt loop, route binding and replay rules are exercised for real without
// reaching a payment network. A deployment swaps this for `stripe.charge()` or
// `tempo.charge()` at the `Mppx.create()` call site; the middleware is
// method-agnostic and does not change.
// ---------------------------------------------------------------------------

const WALLET_SECRET = 'machine-payment-test-wallet-secret';
const METHOD_NAME = 'lobehub-test';
const METHOD_KEY = `${METHOD_NAME}/charge`;

const testCharge = Method.from({
  intent: 'charge',
  name: METHOD_NAME,
  schema: {
    credential: {
      payload: z.object({ signature: z.string(), type: z.enum(['payment', 'proof']) }),
    },
    request: z.object({ amount: z.string(), currency: z.string() }),
  },
});

const sign = (challengeId: string, type: 'payment' | 'proof') =>
  createHmac('sha256', WALLET_SECRET).update(`${challengeId}:${type}`).digest('base64url');

interface Settlement {
  amount: string;
  type: string;
}

const createTestMethod = (settlements: Settlement[]) => {
  const store = Store.memory();

  return {
    ...testCharge,
    verify: async ({ credential, request }: any) => {
      const payload = credential.payload as { signature: string; type: 'payment' | 'proof' };

      // A zero-amount challenge is the metered free tier: the caller proves who
      // it is, but no value moves. Anything else must carry a real payment.
      const expectedType = request.amount === '0' ? 'proof' : 'payment';
      if (payload.type !== expectedType) throw new Error(`expected a "${expectedType}" credential`);
      if (payload.signature !== sign(credential.challenge.id, payload.type))
        throw new Error('invalid payment proof');

      // Replay protection belongs to the method, not the protocol: mppx core
      // re-verifies a credential happily, and only the method knows what
      // "already spent" means for its rail. Card / stablecoin methods inherit
      // this from the network; a method without such a rail must claim the
      // challenge id itself.
      const expires = credential.challenge.expires
        ? Date.parse(credential.challenge.expires)
        : Date.now() + 60_000;
      if (!(await Store.tryClaim(store, `test:${credential.challenge.id}`, expires)))
        throw new Error('credential has already been used');

      settlements.push({ amount: request.amount, type: payload.type });

      return {
        method: METHOD_NAME,
        reference: `ref_${credential.challenge.id.slice(0, 12)}`,
        status: 'success' as const,
        timestamp: new Date().toISOString(),
      };
    },
  };
};

// ---------------------------------------------------------------------------

/** Stands in for `userAuthMiddleware`, minus the database. */
const fakeAuth: MiddlewareHandler = async (c, next) =>
  c.req.header('Authorization')?.startsWith('Bearer sk-lh-')
    ? next()
    : c.json({ error: 'unauthorized' }, 401);

/**
 * Stands in for the cloud override of `resolvePrice`. The open-source stub
 * returns `null` for everything, which is the `/ping` row below.
 */
const PRICES: Record<string, { amount: string; currency: string } | null> = {
  'GET /ping': null,
  'GET /search': { amount: '0.02', currency: 'usd' },
  'GET /search/boom': { amount: '0.05', currency: 'usd' },
  'GET /search/free': { amount: '0', currency: 'usd' },
};

const createApp = (settlements: Settlement[], recorded: MachinePaymentRecordParams[] = []) => {
  const mppx = Mppx.create({
    methods: [createTestMethod(settlements)],
    realm: 'lobehub.test',
    secretKey: 'machine-payment-test-secret-key-at-least-32-bytes',
  });

  const pay = machinePayment({
    methodKey: METHOD_KEY,
    mppx: mppx as any,
    recordPayment: async (params) => {
      recorded.push(params);
    },
    resolvePrice: async ({ route }) => PRICES[route] ?? null,
  });

  const app = new Hono();
  const handler = (c: any) => c.json({ ok: true, tier: c.get('machinePaymentTier') });

  app.get('/ping', pay, requirePaymentOr(fakeAuth), handler);
  app.get('/search/free', pay, requirePaymentOr(fakeAuth), handler);
  app.get('/search', pay, requirePaymentOr(fakeAuth), handler);
  app.get('/search/boom', pay, requirePaymentOr(fakeAuth), () => {
    throw new Error('handler exploded after settlement');
  });

  return app;
};

describe('machinePayment', () => {
  let app: ReturnType<typeof createApp>;
  let settlements: Settlement[];
  let recorded: MachinePaymentRecordParams[];

  beforeEach(() => {
    settlements = [];
    recorded = [];
    app = createApp(settlements, recorded);
  });

  /** Reads the 402 challenge for a route without answering it. */
  const challengeFor = async (path: string) => {
    const res = await app.request(path);
    expect(res.status).toBe(402);
    return Challenge.fromResponse(res);
  };

  /** Mints a credential, defaulting to the proof type the challenge requires. */
  const mint = (challenge: any, type?: 'payment' | 'proof') => {
    const t = type ?? (challenge.request.amount === '0' ? 'proof' : 'payment');
    return Credential.serialize(
      Credential.from({
        challenge,
        payload: { signature: sign(challenge.id, t), type: t },
        source: 'did:test:agent-001',
      }),
    );
  };

  const submit = (path: string, credential: string) =>
    app.request(path, { headers: { Authorization: credential } });

  describe('unpriced routes (open-source default)', () => {
    it('issues no challenge and keeps the route behind auth', async () => {
      const res = await app.request('/ping');

      expect(res.status).toBe(401);
      // An unpriced route must not advertise itself as purchasable, or a caller
      // would believe paying is a way around authentication.
      expect(res.headers.get('WWW-Authenticate')).toBeNull();
    });

    it('serves the route to an authenticated caller', async () => {
      const res = await app.request('/ping', { headers: { Authorization: 'Bearer sk-lh-test' } });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, tier: 'unpriced' });
    });

    it('settles nothing', async () => {
      await app.request('/ping', { headers: { Authorization: 'Bearer sk-lh-test' } });

      expect(settlements).toHaveLength(0);
    });
  });

  describe('free tier (zero-amount challenge)', () => {
    it('challenges for zero value', async () => {
      expect((await challengeFor('/search/free')).request.amount).toBe('0');
    });

    it('serves the route after an identity proof, with no account', async () => {
      const challenge = await challengeFor('/search/free');
      const res = await submit('/search/free', mint(challenge));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, tier: 'free' });
    });

    it('records the call without charging', async () => {
      const challenge = await challengeFor('/search/free');
      await submit('/search/free', mint(challenge));

      expect(settlements).toEqual([{ amount: '0', type: 'proof' }]);
    });

    it('rejects a payment-typed credential where a proof is required', async () => {
      const challenge = await challengeFor('/search/free');
      const res = await submit('/search/free', mint(challenge, 'payment'));

      expect(res.status).toBe(402);
      expect(settlements).toHaveLength(0);
    });
  });

  describe('paid tier', () => {
    it('challenges for the resolved price', async () => {
      expect((await challengeFor('/search')).request).toMatchObject({
        amount: '0.02',
        currency: 'usd',
      });
    });

    it('serves the route and attaches a receipt after payment', async () => {
      const challenge = await challengeFor('/search');
      const res = await submit('/search', mint(challenge));

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ tier: 'paid' });
      // The receipt is attached server-side after settlement, so it cannot be
      // forged into the response: a 200 carrying one is a paid 200.
      expect(res.headers.get('Payment-Receipt')).toBeTruthy();
    });

    it('rejects a free-tier proof presented against a priced challenge', async () => {
      const challenge = await challengeFor('/search');
      const res = await submit('/search', mint(challenge, 'proof'));

      expect(res.status).toBe(402);
      expect(settlements).toHaveLength(0);
    });

    it('rejects a forged proof', async () => {
      const challenge = await challengeFor('/search');
      const forged = Credential.serialize(
        Credential.from({ challenge, payload: { signature: 'not-a-signature', type: 'payment' } }),
      );

      const res = await submit('/search', forged);

      expect(res.status).toBe(402);
      expect(settlements).toHaveLength(0);
    });
  });

  describe('credential scoping', () => {
    it('does not accept a credential minted for another route', async () => {
      // Without route binding, a caller could answer the cheapest endpoint's
      // challenge and spend it on the most expensive one.
      const challenge = await challengeFor('/search/free');
      const res = await submit('/search', mint(challenge));

      expect(res.status).toBe(402);
      expect(settlements).toHaveLength(0);
    });

    it('binds the issuing route into the challenge', async () => {
      const challenge = await challengeFor('/search/free');
      const opaque = JSON.parse(Buffer.from(challenge.opaque!, 'base64url').toString('utf8'));

      expect(opaque).toMatchObject({ _mppx_scope: 'GET /search/free' });
    });
  });

  describe('replay', () => {
    it('does not settle the same credential twice', async () => {
      const challenge = await challengeFor('/search');
      const credential = mint(challenge);

      const first = await submit('/search', credential);
      const second = await submit('/search', credential);

      expect(first.status).toBe(200);
      expect(second.status).toBe(402);
      expect(settlements).toHaveLength(1);
    });
  });

  describe('authenticated callers on a priced route', () => {
    it('serves an API-key caller without demanding payment', async () => {
      // Pricing an existing route must not replace authentication: its current
      // authenticated clients would all start getting 402.
      const res = await app.request('/search', { headers: { Authorization: 'Bearer sk-lh-test' } });

      expect(res.status).toBe(200);
      expect(settlements).toHaveLength(0);
    });

    it('reports the request as authenticated rather than paid', async () => {
      const res = await app.request('/search', { headers: { Authorization: 'Bearer sk-lh-test' } });

      expect(await res.json()).toEqual({ ok: true, tier: 'authenticated' });
    });

    it('still rejects a bad Bearer token instead of letting it skip both gates', async () => {
      const res = await app.request('/search', { headers: { Authorization: 'Bearer nope' } });

      expect(res.status).toBe(401);
      expect(settlements).toHaveLength(0);
    });

    it('challenges a caller that presents no credential at all', async () => {
      const res = await app.request('/search');

      expect(res.status).toBe(402);
    });
  });

  describe('ledger recording', () => {
    it('records a paid settlement with its route, price, reference and payer', async () => {
      const challenge = await challengeFor('/search');
      await submit('/search', mint(challenge));

      expect(recorded).toEqual([
        {
          amount: '0.02',
          currency: 'usd',
          reference: expect.stringContaining('ref_'),
          route: 'GET /search',
          source: 'did:test:agent-001',
        },
      ]);
    });

    it('records a zero-amount free-tier call so the tier stays metered', async () => {
      const challenge = await challengeFor('/search/free');
      await submit('/search/free', mint(challenge));

      expect(recorded).toEqual([
        expect.objectContaining({ amount: '0', route: 'GET /search/free' }),
      ]);
    });

    it('records nothing when no payment settled', async () => {
      await app.request('/ping', { headers: { Authorization: 'Bearer sk-lh-test' } });

      expect(recorded).toHaveLength(0);
    });
  });

  describe('settled requests that fail downstream', () => {
    it('still returns the receipt when the handler throws', async () => {
      const challenge = await challengeFor('/search/boom');
      const res = await submit('/search/boom', mint(challenge));

      // The credential already settled and cannot be replayed, so an
      // unreceipted error would leave the payer unable to prove the charge.
      expect(settlements).toHaveLength(1);
      expect(res.headers.get('Payment-Receipt')).toBeTruthy();
    });

    it('surfaces the failure rather than reporting success', async () => {
      const challenge = await challengeFor('/search/boom');
      const res = await submit('/search/boom', mint(challenge));

      expect(res.status).toBeGreaterThanOrEqual(500);
    });
  });
});
