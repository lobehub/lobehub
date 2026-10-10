import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MachinePaymentRail,
  MachinePaymentRecordParams,
} from '@/business/server/machine-payments/types';

const state = vi.hoisted(() => ({
  rail: null as unknown,
  recorded: [] as unknown[],
  runtimeCalls: [] as { api: string; args: unknown; identifier: string; userId?: string }[],
  runtimeResult: { content: '<results />', state: { results: [] }, success: true } as Record<
    string,
    unknown
  >,
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
// Same contract as the real `requireAuth`: it gates on the resolved user.
vi.mock('../middleware/auth', () => ({
  requireAuth: async (c: any, next: any) =>
    c.get('userId') ? next() : c.json({ error: 'Authentication required' }, 401),
}));
vi.mock('@/business/server/machine-payments/getPaymentRail', () => ({
  getPaymentRail: () => state.rail,
}));
vi.mock('@/business/server/machine-payments/resolvePrice', () => ({
  resolvePrice: async () => ({ amount: '0.02', currency: 'usd' }),
}));
vi.mock('@/business/server/machine-payments/recordPayment', () => ({
  recordPayment: async (params: MachinePaymentRecordParams) => {
    state.recorded.push(params);
  },
}));
// Stands in for the server runtime registry, so the test pins what the gateway
// lets through rather than what the search provider returns.
vi.mock('@/server/services/toolExecution/serverRuntimes', () => ({
  getServerRuntime: (identifier: string, context: { userId?: string }) => {
    const api = (name: string) => async (args: unknown) => {
      state.runtimeCalls.push({ api: name, args, identifier, userId: context.userId });
      return state.runtimeResult;
    };
    return {
      crawlMultiPages: api('crawlMultiPages'),
      crawlSinglePage: api('crawlSinglePage'),
      search: api('search'),
    };
  },
}));

/**
 * A rail that settles any `Payment` credential. The real challenge/credential
 * loop is covered by `machine-payment.test.ts`; here only the wiring matters.
 */
const fakeRail: MachinePaymentRail = {
  methodKey: 'fake/charge',
  mppx: {
    compose: () => async (request) =>
      request.headers.get('Authorization')?.startsWith('Payment ')
        ? { status: 200, withReceipt: (response) => response }
        : { challenge: new Response(null, { status: 402 }), status: 402 },
  },
};

/** Loads the route fresh, since the payment gate memoizes the rail on first use. */
const loadApp = async (rail: MachinePaymentRail | null, userId?: string) => {
  state.rail = rail;
  vi.resetModules();
  const { default: ToolRoutes } = await import('./tools.route');

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, (userId ?? null) as never);
    await next();
  });
  app.route('/tools', ToolRoutes);
  return app;
};

const post = (app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  });

const SEARCH = '/tools/lobe-web-browsing/search';

// The route pulls in every builtin tool manifest. Transforming that graph the
// first time can exceed the default per-test timeout on a cold CI runner, so
// pay it once here; `loadApp`'s later re-imports reuse the transform cache.
beforeAll(async () => {
  await import('./tools.route');
}, 60_000);

beforeEach(() => {
  state.recorded = [];
  state.runtimeCalls = [];
  state.runtimeResult = { content: '<results />', state: { results: [] }, success: true };
});

describe('without a payment rail (open-source default)', () => {
  it('keeps an anonymous caller out', async () => {
    const app = await loadApp(null);

    const res = await post(app, SEARCH, { query: 'lobehub' });

    expect(res.status).toBe(401);
    expect(state.runtimeCalls).toHaveLength(0);
  });

  it('runs the tool for an authenticated caller, as that user', async () => {
    const app = await loadApp(null, 'user-1');

    const res = await post(app, SEARCH, { query: 'lobehub' });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ content: '<results />', state: { results: [] } });
    expect(state.runtimeCalls).toEqual([
      {
        api: 'search',
        args: { query: 'lobehub' },
        identifier: 'lobe-web-browsing',
        userId: 'user-1',
      },
    ]);
  });

  it('lists the catalog without a price, and without an account', async () => {
    const app = await loadApp(null);

    const res = await app.request('/tools');
    const [tool] = (await res.json()).data.tools;

    expect(res.status).toBe(200);
    expect(tool.identifier).toBe('lobe-web-browsing');
    expect(tool.apis.map((api: any) => [api.name, api.path, api.price])).toEqual([
      ['search', SEARCH, null],
      ['crawlSinglePage', '/tools/lobe-web-browsing/crawlSinglePage', null],
    ]);
    expect(tool.apis[0].parameters.required).toEqual(['query']);
  });
});

describe('exposure', () => {
  it.each([
    ['an unbounded API of a public tool', '/tools/lobe-web-browsing/crawlMultiPages'],
    ['a tool that touches user data', '/tools/lobe-user-memory/searchUserMemory'],
  ])('refuses %s as not found', async (_label, path) => {
    const app = await loadApp(null, 'user-1');

    const res = await post(app, path, { urls: ['https://lobehub.com'] });

    expect(res.status).toBe(404);
    expect(state.runtimeCalls).toHaveLength(0);
  });

  it('rejects missing required arguments before running the tool', async () => {
    const app = await loadApp(null, 'user-1');

    const res = await post(app, SEARCH, { searchCategories: ['news'] });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('query');
    expect(state.runtimeCalls).toHaveLength(0);
  });

  it('rejects a body that is not an arguments object', async () => {
    const app = await loadApp(null, 'user-1');

    const res = await post(app, SEARCH, ['lobehub']);

    expect(res.status).toBe(400);
  });

  it('reports a tool that ran but failed as an upstream error', async () => {
    state.runtimeResult = { content: 'search provider unavailable', success: false };
    const app = await loadApp(null, 'user-1');

    const res = await post(app, SEARCH, { query: 'lobehub' });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('search provider unavailable');
  });
});

describe('with a payment rail', () => {
  it('challenges an anonymous caller instead of refusing it', async () => {
    const app = await loadApp(fakeRail);

    const res = await post(app, SEARCH, { query: 'lobehub' });

    expect(res.status).toBe(402);
    expect(state.runtimeCalls).toHaveLength(0);
  });

  it('runs the tool for a caller who paid, with no account, and records the payment', async () => {
    const app = await loadApp(fakeRail);

    const res = await post(app, SEARCH, { query: 'lobehub' }, { Authorization: 'Payment cred' });

    expect(res.status).toBe(200);
    expect(state.runtimeCalls).toEqual([
      { api: 'search', args: { query: 'lobehub' }, identifier: 'lobe-web-browsing' },
    ]);
    expect(state.recorded).toEqual([
      expect.objectContaining({ amount: '0.02', currency: 'usd', route: `POST ${SEARCH}` }),
    ]);
  });

  it('does not charge an authenticated caller', async () => {
    const app = await loadApp(fakeRail, 'user-1');

    const res = await post(app, SEARCH, { query: 'lobehub' });

    expect(res.status).toBe(200);
    expect(state.recorded).toHaveLength(0);
  });

  it('advertises the price that will be charged', async () => {
    const app = await loadApp(fakeRail);

    const [tool] = (await (await app.request('/tools')).json()).data.tools;

    expect(tool.apis[0]).toMatchObject({
      method: 'POST',
      path: SEARCH,
      price: { amount: '0.02', currency: 'usd' },
    });
  });
});
