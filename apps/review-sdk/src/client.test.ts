import { describe, expect, it, vi } from 'vitest';

import {
  DENIED_MESSAGE,
  randomHandoffId,
  ReviewClient,
  ReviewError,
  SESSION_MESSAGE,
} from './client';

const SERVER = 'https://app.lobehub.test';
const ACCEPTANCE = 'acc-1';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

const session = (overrides: Record<string, unknown> = {}) => ({
  acceptance: { id: ACCEPTANCE, status: 'delivered', title: 'Tab titles' },
  capabilities: ['comment', 'reject'],
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  token: 'review-token',
  type: SESSION_MESSAGE,
  ...overrides,
});

const client = (fetchImpl?: typeof fetch, storage = memoryStorage()) =>
  new ReviewClient({
    acceptanceId: ACCEPTANCE,
    fetch: fetchImpl,
    server: `${SERVER}/some/path`,
    storage,
  });

describe('acceptMessage', () => {
  it('takes a session only from the LobeHub origin and only for this acceptance', () => {
    const c = client();
    expect(c.acceptMessage({ data: session(), origin: 'https://evil.test' })).toBeNull();
    expect(
      c.acceptMessage({ data: session({ acceptance: { id: 'other' } }), origin: SERVER }),
    ).toBeNull();
    expect(c.acceptMessage({ data: { type: 'something-else' }, origin: SERVER })).toBeNull();
    expect(c.current()).toBeNull();

    expect(c.acceptMessage({ data: session(), origin: SERVER })).toMatchObject({
      token: 'review-token',
    });
    expect(c.current()?.capabilities).toEqual(['comment', 'reject']);
  });

  it('recognizes an explicit denial', () => {
    expect(client().acceptMessage({ data: { type: DENIED_MESSAGE }, origin: SERVER })).toBe(
      'denied',
    );
  });

  it('keeps the session for the tab and drops it once expired', () => {
    const storage = memoryStorage();
    client(undefined, storage).acceptMessage({ data: session(), origin: SERVER });
    expect(client(undefined, storage).current()?.token).toBe('review-token');

    const stale = memoryStorage();
    client(undefined, stale).acceptMessage({
      data: session({ expiresAt: new Date(Date.now() + 5_000).toISOString() }),
      origin: SERVER,
    });
    expect(client(undefined, stale).current()).toBeNull();
  });
});

describe('connectUrl', () => {
  it('asks LobeHub to approve this page origin for this acceptance', () => {
    const url = new URL(client().connectUrl('https://product.test'));
    expect(url.origin + url.pathname).toBe(`${SERVER}/oauth/acceptance-review`);
    expect(url.searchParams.get('acceptance')).toBe(ACCEPTANCE);
    expect(url.searchParams.get('origin')).toBe('https://product.test');
  });
});

describe('requests', () => {
  it('sends the bearer token to the review API', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ items: [] }));
    const c = client(fetchImpl as unknown as typeof fetch);
    c.acceptMessage({ data: session(), origin: SERVER });

    await c.listMine();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${SERVER}/api/acceptance-review/comments`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer review-token');
  });

  it('refuses to call without a session', async () => {
    await expect(client().listMine()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('surfaces the server error and forgets a dead session', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Review session expired or invalid' } },
        { status: 401 },
      ),
    );
    const c = client(fetchImpl as unknown as typeof fetch);
    c.acceptMessage({ data: session(), origin: SERVER });

    const error = await c.reject('x').catch((e) => e);
    expect(error).toBeInstanceOf(ReviewError);
    expect(error).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Review session expired or invalid',
      status: 401,
    });
    expect(c.current()).toBeNull();
  });
});

describe('handoff fallback', () => {
  it('uses an unguessable one-time id and carries it in the approval link', () => {
    const a = randomHandoffId();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(randomHandoffId()).not.toBe(a);
    const url = new URL(client().connectUrl('https://product.test', a));
    expect(url.searchParams.get('handoff')).toBe(a);
  });

  it('claims a parked session for this acceptance and keeps it for the tab', async () => {
    const { type: _type, ...parked } = session();
    const fetchImpl = vi.fn(async () => Response.json(parked));
    const c = client(fetchImpl as unknown as typeof fetch);

    await expect(c.claimHandoff('h'.repeat(43))).resolves.toMatchObject({ token: 'review-token' });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      `${SERVER}/api/acceptance-review/handoff?id=${'h'.repeat(43)}`,
    );
    expect(c.current()?.token).toBe('review-token');
  });

  it('keeps waiting while nothing is parked, and ignores a session for another acceptance', async () => {
    const notYet = client(
      vi.fn(async () => Response.json({}, { status: 404 })) as unknown as typeof fetch,
    );
    await expect(notYet.claimHandoff('x'.repeat(43))).resolves.toBeNull();

    const { type: _type, ...other } = session({ acceptance: { id: 'other' } });
    const wrong = client(vi.fn(async () => Response.json(other)) as unknown as typeof fetch);
    await expect(wrong.claimHandoff('x'.repeat(43))).resolves.toBeNull();
    expect(wrong.current()).toBeNull();
  });
});
