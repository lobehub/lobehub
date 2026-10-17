// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  acceptanceComments,
  acceptances,
  files,
  users,
  verifyRuns,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ResourceEvents from '@/server/services/resourceEvents';

let serverDB: LobeChatDatabase;

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  signals: [] as AbortSignal[],
  upload: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => serverDB }));
vi.mock('@/libs/oidc-provider/jwt', () => ({
  verifyAcceptanceReviewJWT: async (token: string) => {
    const [userId, acceptanceId] = token.split('|');
    if (!acceptanceId) throw new Error('invalid');
    return { acceptanceId, expiresAt: 2_000_000_000, userId };
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (url: string) => `https://cdn.example.com/${url}`;
    uploadFromBuffer = mocks.upload;
  },
}));
vi.mock('@/server/routers/lambda/_helpers/acceptanceRepairDispatch', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatchAcceptanceRepair: mocks.dispatch,
}));
vi.mock('@/server/services/resourceEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof ResourceEvents>();
  return {
    ...actual,
    subscribeResourceEvents: (...args: Parameters<typeof actual.subscribeResourceEvents>) => {
      mocks.signals.push(args[2]);
      return actual.subscribeResourceEvents(...args);
    },
  };
});
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));

const { default: app } = await import('../index');

const BASE = 'http://localhost/api/acceptance-review/v1';
const JPEG = `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`;

const anchor = {
  env: { consoleErrors: ['TypeError: x is undefined'], userAgent: 'Chrome' },
  intent: 'comment',
  scroll: { x: 0, y: 0 },
  targets: [{ label: 'Pay', rect: { height: 40, width: 120, x: 10, y: 20 }, selector: '#pay' }],
  url: 'https://preview.example.com/checkout',
  v: 1,
  viewport: { dpr: 2, height: 800, width: 1280 },
};

let ownerId: string;
let visitorId: string;
let acceptanceId: string;
let privateId: string;

const call = (
  userId: string,
  path: string,
  init: RequestInit & { json?: unknown; target?: string } = {},
) => {
  const { json, target = acceptanceId, ...rest } = init;
  return app.request(`${BASE}${path}`, {
    ...rest,
    body: json === undefined ? rest.body : JSON.stringify(json),
    headers: {
      'authorization': `Bearer ${userId}|${target}`,
      'content-type': 'application/json',
      'origin': 'https://preview.example.com',
      ...(rest.headers as Record<string, string>),
    },
  });
};

const post = (userId: string, json: Record<string, unknown>) =>
  call(userId, '/comments', { json: { clientId: randomUUID(), ...json }, method: 'POST' });

beforeEach(async () => {
  serverDB = await getTestDB();
  ownerId = randomUUID();
  visitorId = randomUUID();
  await serverDB.insert(users).values([
    { fullName: 'Olivia Owner', id: ownerId },
    { id: visitorId, username: 'vic' },
  ]);
  const [shared, hidden] = await serverDB
    .insert(acceptances)
    .values([
      {
        metadata: { title: 'Billing redesign' },
        requirement: 'Pay button works',
        status: 'delivered',
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId: ownerId,
        visibility: 'public',
      },
      {
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId: ownerId,
        visibility: 'private',
      },
    ])
    .returning();
  acceptanceId = shared.id;
  privateId = hidden.id;
  await serverDB.insert(verifyRuns).values([
    { acceptanceId, roundIndex: 1, userId: ownerId },
    {
      acceptanceId,
      metadata: { previewUrl: 'https://preview.example.com/' },
      roundIndex: 2,
      userId: ownerId,
    },
  ]);
  mocks.upload.mockImplementation(async (buffer: Buffer, mimeType: string, pathname: string) => {
    const [file] = await serverDB
      .insert(files)
      .values({
        fileType: mimeType,
        name: 'shot',
        size: buffer.length,
        url: pathname,
        userId: visitorId,
      })
      .returning();
    return { fileId: file.id, key: pathname, url: pathname };
  });
  mocks.dispatch.mockResolvedValue({ dispatched: false, reason: 'no_origin' });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
  await serverDB.delete(users).where(eq(users.id, visitorId));
  vi.clearAllMocks();
});

describe('auth', () => {
  it('refuses a request without a review token', async () => {
    const res = await app.request(`${BASE}/session`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('refuses a token that does not verify', async () => {
    const res = await app.request(`${BASE}/session`, { headers: { authorization: 'Bearer junk' } });
    expect(res.status).toBe(401);
  });

  it('hides an acceptance the user can no longer read', async () => {
    const res = await call(visitorId, '/session', { target: privateId });
    expect(res.status).toBe(404);
  });

  it('answers a preflight from any preview origin', async () => {
    const res = await app.request(`${BASE}/comments`, {
      headers: {
        'access-control-request-method': 'POST',
        'origin': 'https://preview.example.com',
      },
      method: 'OPTIONS',
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://preview.example.com');
  });
});

describe('GET /session', () => {
  it('describes the acceptance, the latest round and what the owner may do', async () => {
    const res = await call(ownerId, '/session');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      acceptance: {
        id: acceptanceId,
        previewUrl: 'https://preview.example.com/',
        requirement: 'Pay button works',
        round: 2,
        status: 'delivered',
        title: 'Billing redesign',
      },
      can: { comment: true, decide: true, moderate: true },
      expiresAt: new Date(2_000_000_000 * 1000).toISOString(),
      user: { id: ownerId, name: 'Olivia Owner' },
    });
    expect(body.acceptance.url).toMatch(new RegExp(`/acceptance/${acceptanceId}$`));
  });

  it('lets a public-link visitor comment but not decide', async () => {
    const body = await (await call(visitorId, '/session')).json();
    expect(body.can).toEqual({ comment: true, decide: false, moderate: false });
    expect(body.user).toMatchObject({ id: visitorId, name: 'vic' });
  });
});

describe('comments', () => {
  it('creates a pinned remark and lists it with its replies nested', async () => {
    const created = await post(visitorId, { anchor, content: 'overlaps the total' });
    expect(created.status).toBe(201);
    const root = await created.json();
    expect(root).toMatchObject({
      anchor,
      author: { id: visitorId, name: 'vic' },
      content: 'overlaps the total',
      mine: true,
      parentId: null,
      replies: [],
      resolvedAt: null,
      round: 2,
      screenshot: null,
    });

    await post(ownerId, { content: 'on it', parentId: root.id });
    const { items: list } = await (await call(visitorId, '/comments')).json();
    expect(list).toHaveLength(1);
    expect(list[0].replies).toMatchObject([{ content: 'on it', mine: false, parentId: root.id }]);
  });

  it('answers a retried clientId with the remark that already landed', async () => {
    const clientId = randomUUID();
    const first = await (await post(visitorId, { clientId, content: 'once' })).json();
    const again = await (await post(visitorId, { clientId, content: 'once' })).json();
    expect(again.id).toBe(first.id);
  });

  it('keeps the reporter environment from readers who are not moderators', async () => {
    await post(visitorId, { anchor, content: 'with env' });
    const stranger = randomUUID();
    await serverDB.insert(users).values({ id: stranger });
    const {
      items: [forStranger],
    } = await (await call(stranger, '/comments')).json();
    const {
      items: [forOwner],
    } = await (await call(ownerId, '/comments')).json();
    await serverDB.delete(users).where(eq(users.id, stranger));
    expect(forStranger.anchor.env).toBeUndefined();
    expect(forOwner.anchor.env).toEqual(anchor.env);
  });

  it('stores a screenshot as an acceptance file', async () => {
    const res = await post(visitorId, { anchor, content: 'see', screenshot: { dataUrl: JPEG } });
    const body = await res.json();
    expect(mocks.upload).toHaveBeenCalledWith(
      Buffer.from('jpeg-bytes'),
      'image/jpeg',
      expect.stringMatching(/\.jpg$/),
      expect.any(Function),
      expect.objectContaining({ source: 'acceptance' }),
    );
    expect(body.screenshot).toEqual({
      url: expect.stringMatching(/^https:\/\/cdn\.example\.com\//),
    });
  });

  it('keeps the remark when the screenshot cannot be stored', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.upload.mockRejectedValueOnce(new Error('storage down'));
    const res = await post(visitorId, { anchor, content: 'see', screenshot: { dataUrl: JPEG } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ content: 'see', screenshot: null });
  });

  it('rejects malformed input with INVALID_INPUT', async () => {
    const res = await post(visitorId, { content: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('rejects a body over 2MB with TOO_LARGE', async () => {
    const res = await post(visitorId, { content: 'x'.repeat(2 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'TOO_LARGE' } });
  });

  it('resolves a thread and reports when', async () => {
    const root = await (await post(visitorId, { content: 'fix me' })).json();
    const res = await call(visitorId, `/comments/${root.id}`, {
      json: { resolved: true },
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: root.id, resolvedAt: expect.any(String) });
  });

  it('treats a comment of another acceptance as missing', async () => {
    const [foreign] = await serverDB
      .insert(acceptanceComments)
      .values({ acceptanceId: privateId, authorUserId: ownerId, clientId: 'x', content: 'secret' })
      .returning();
    const res = await call(ownerId, `/comments/${foreign.id}`, {
      json: { resolved: true },
      method: 'PATCH',
    });
    expect(res.status).toBe(404);
    expect((await call(ownerId, `/comments/${foreign.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('deletes a remark so it leaves the list', async () => {
    const root = await (await post(visitorId, { content: 'oops' })).json();
    const res = await call(visitorId, `/comments/${root.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await (await call(visitorId, '/comments')).json()).toEqual({ items: [] });
  });

  it('forbids another reader from deleting a remark', async () => {
    const root = await (await post(ownerId, { content: 'mine' })).json();
    const res = await call(visitorId, `/comments/${root.id}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});

describe('POST /decision', () => {
  it('forbids a reader who cannot manage the acceptance', async () => {
    const res = await call(visitorId, '/decision', { json: { verdict: 'accept' }, method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('refuses a verdict while the round is still being verified', async () => {
    await serverDB
      .update(acceptances)
      .set({ status: 'verifying' })
      .where(eq(acceptances.id, acceptanceId));
    const res = await call(ownerId, '/decision', { json: { verdict: 'accept' }, method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
  });

  it('accepts a delivered round', async () => {
    const res = await call(ownerId, '/decision', {
      json: { note: 'ship it', verdict: 'accept' },
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'accepted' });
  });

  it('sends a round back and says whether the agent was started', async () => {
    const res = await call(ownerId, '/decision', {
      json: { note: 'pay button overlaps', verdict: 'send_back' },
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dispatched: false, status: 'rejected' });
  });
});

describe('GET /events', () => {
  const open = async (userId: string) => {
    const res = await call(userId, '/events');
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    const until = async (pattern: RegExp) => {
      while (!pattern.test(buffer)) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`stream closed before ${pattern}`);
        buffer += value;
      }
    };
    return { close: () => reader.cancel(), res, until };
  };

  it('signals comment changes made through the API', async () => {
    const events = await open(visitorId);
    expect(events.res.headers.get('content-type')).toMatch(/text\/event-stream/);
    await events.until(/event: ready/);
    await post(visitorId, { content: 'live' });
    await events.until(/event: acceptance\.commentsChanged/);
    await events.close();
  });

  it('signals a decision as a session change', async () => {
    const events = await open(ownerId);
    await events.until(/event: ready/);
    await call(ownerId, '/decision', { json: { verdict: 'accept' }, method: 'POST' });
    await events.until(/event: acceptance\.sessionChanged/);
    await events.close();
  });

  it('drops the subscription when the reader disconnects', async () => {
    const events = await open(visitorId);
    await events.until(/event: ready/);
    await events.close();
    await vi.waitFor(() => expect(mocks.signals.at(-1)?.aborted).toBe(true));
  });

  it('refuses a reader without access before streaming', async () => {
    const res = await call(visitorId, '/events', { target: privateId });
    expect(res.status).toBe(404);
  });
});
