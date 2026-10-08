// @vitest-environment node
import { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FactoryModule from '@/server/services/agentHumanRequest/factory';

/**
 * End-to-end run of the approval / secure-input card API over real HTTP.
 *
 * Real `HumanRequestRoutes`, real auth + workspace + permission middleware,
 * real controller, real `AgentHumanRequestService` (via its production
 * factory), Drizzle models on PGlite, the real KeyVaults gatekeeper, and the
 * reference ASC/1 client (`sealSecret`) doing what a native app does. Two
 * collaborators are stand-ins:
 *
 * - the outbound channel (`sender`): a recorder injected into the factory —
 *   the agent-account send path is wired in by the identity layer;
 * - the agent wake (`AiAgentService.execAgent`): a recorder, so the test can
 *   read the exact outcome turn the agent would get.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');
process.env.CLOUD_DATABASE_URL ??= 'postgresql://mock:mock@localhost:5432/mock';
process.env.QSTASH_TOKEN ??= 'mock-qstash-token';

const holder = vi.hoisted(() => ({
  notified: [] as { prompt: string }[],
  sent: [] as { message: Record<string, unknown>; to: string }[],
  serverDB: undefined as unknown,
  sendFails: false,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@/server/services/agentHumanRequest/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof FactoryModule>();
  return {
    ...actual,
    createAgentHumanRequestService: (
      ...[db, userId, options = {}]: Parameters<typeof actual.createAgentHumanRequestService>
    ) =>
      actual.createAgentHumanRequestService(db, userId, {
        ...options,
        sender: async (_accountId, message) => {
          if (holder.sendFails) throw new Error(`smtp 554 rejected: ${String(message.text)}`);
          holder.sent.push({ message: { ...message }, to: String(message.to) });
          return { providerMessageId: `pm-${holder.sent.length}` };
        },
      }),
  };
});

vi.mock('@/server/services/agentHumanRequest/notifier', async () => {
  const { buildOutcomePrompt } = await import('@/server/services/agentHumanRequest/outcomePrompt');
  return {
    createAgentHumanRequestNotifier: () => ({
      notify: async (item: unknown) => {
        holder.notified.push({ prompt: buildOutcomePrompt(item as never) });
      },
    }),
  };
});

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, agentHumanRequests, apiKeys, users } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { sealSecret, utf8Encode, verifyRequest } = await import('@lobechat/secret-channel');
const { createAgentHumanRequestService } =
  await import('@/server/services/agentHumanRequest/factory');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const HumanRequestRoutes = (await import('./human-requests.route')).default;
const { eq } = await import('drizzle-orm');

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/human-requests', HumanRequestRoutes);

const OWNER = 't636-owner';
const STRANGER = 't636-stranger';
const AGENT = 't636-agent';

const OWNER_KEY = 'sk-lh-t636ownerfull001';
const RESTRICTED_KEY = 'sk-lh-t636restricted01';
const STRANGER_KEY = 'sk-lh-t636strangerkey1';
const NO_AGENT_READ_KEY = 'sk-lh-t636noagentread1';

const CODE = '739104';

const call = (path: string, init: RequestInit & { key: string }) => {
  const { key, ...rest } = init;
  return app.request(`/api/v1${path}`, {
    ...rest,
    headers: {
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json',
      ...rest.headers,
    },
  });
};

const json = async (res: Response) => (await res.json()) as any;

const decide = (id: string, decision: unknown, key = OWNER_KEY) =>
  call(`/human-requests/${id}/decision`, {
    body: JSON.stringify({ decision, via: 'ios' }),
    key,
    method: 'POST',
  });

const accountId = 'acc-t636-mail';

/** The agent side: what the tool runtime does when it parks an action. */
const park = async () => {
  const service = await createAgentHumanRequestService(serverDB, OWNER);
  const action = {
    accountId,
    channel: 'mail' as const,
    from: 'aria@lobe.id',
  };
  return {
    approval: () =>
      service.requestApproval(
        { agentId: AGENT, operationId: 'op-t636' },
        { ...action, subject: 'Lunch', text: 'Lunch on Friday?', to: 'bob@example.com' },
      ),
    secret: () =>
      service.requestSecret(
        { agentId: AGENT, operationId: 'op-t636' },
        {
          ...action,
          kind: 'otp',
          reason: 'The bank texted a code to your phone.',
          subject: 'Re: confirm',
          text: 'The confirmation code is {{secret}}',
          to: 'verify@bank.example',
        },
      ),
  };
};

beforeEach(async () => {
  holder.sent = [];
  holder.notified = [];
  holder.sendFails = false;
  await serverDB.delete(agentHumanRequests);
  await serverDB.delete(apiKeys);
  await serverDB.delete(agents);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(agents).values({ id: AGENT, userId: OWNER });
  await serverDB.insert(apiKeys).values([
    { key: OWNER_KEY, keyHash: hashApiKey(OWNER_KEY), name: 'owner', scopes: ['*'], userId: OWNER },
    {
      key: RESTRICTED_KEY,
      keyHash: hashApiKey(RESTRICTED_KEY),
      name: 'automation',
      scopes: ['agent:read', 'agent:write', 'message:write'],
      userId: OWNER,
    },
    {
      key: NO_AGENT_READ_KEY,
      keyHash: hashApiKey(NO_AGENT_READ_KEY),
      name: 'knowledge-only',
      scopes: ['knowledge:read'],
      userId: OWNER,
    },
    {
      key: STRANGER_KEY,
      keyHash: hashApiKey(STRANGER_KEY),
      name: 'stranger',
      scopes: ['*'],
      userId: STRANGER,
    },
  ]);
});

afterAll(async () => {
  await serverDB.delete(agentHumanRequests);
  await serverDB.delete(apiKeys);
  await serverDB.delete(agents);
  await serverDB.delete(users);
});

describe('human requests API — end to end', () => {
  it('lists an approval card, sends the edited message once, and reports it to the agent', async () => {
    const parked = await (await park()).approval();

    const listRes = await call('/human-requests?status=pending', { key: OWNER_KEY });
    expect(listRes.status).toBe(200);
    const listed = await json(listRes);
    expect(listed.data.requests).toHaveLength(1);
    expect(listed.data.requests[0]).toMatchObject({
      action: {
        from: 'aria@lobe.id',
        subject: 'Lunch',
        text: 'Lunch on Friday?',
        to: 'bob@example.com',
      },
      id: parked.id,
      status: 'pending',
      type: 'approval',
    });
    expect(holder.sent).toHaveLength(0);

    const approved = await decide(parked.id, {
      action: 'approve',
      edits: { text: 'Lunch on Thursday instead?' },
    });
    expect(approved.status).toBe(200);
    const body = await json(approved);
    expect(body.data).toMatchObject({
      decidedVia: 'ios',
      originalAction: { text: 'Lunch on Friday?' },
      result: { edited: true, providerMessageId: 'pm-1' },
      status: 'completed',
    });
    expect(holder.sent).toEqual([
      {
        message: expect.objectContaining({ text: 'Lunch on Thursday instead?' }),
        to: 'bob@example.com',
      },
    ]);
    expect(holder.notified[0].prompt).toContain('edited your email');

    const again = await decide(parked.id, { action: 'approve' });
    expect(again.status).toBe(409);
    expect(holder.sent).toHaveLength(1);
  });

  it('discards a card without sending', async () => {
    const parked = await (await park()).approval();

    const res = await decide(parked.id, { action: 'decline' });

    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe('declined');
    expect(holder.sent).toHaveLength(0);
    expect(holder.notified[0].prompt).toContain('discarded');
  });

  it('marks a failed send and retries it on request', async () => {
    const parked = await (await park()).approval();

    holder.sendFails = true;
    const failed = await json(await decide(parked.id, { action: 'approve' }));
    expect(failed.data.status).toBe('failed');

    holder.sendFails = false;
    const retried = await json(await decide(parked.id, { action: 'retry' }));
    expect(retried.data).toMatchObject({
      result: { providerMessageId: 'pm-1' },
      status: 'completed',
    });
  });

  it('fulfils a secure-input card with an ASC envelope; the code is sent and nowhere else', async () => {
    const parked = await (await park()).secret();

    // A client pins the server identity and verifies the request before sealing.
    const identity = (await json(await call('/human-requests/identity', { key: OWNER_KEY }))).data;
    const card = (await json(await call(`/human-requests/${parked.id}`, { key: OWNER_KEY }))).data;
    expect(card.secret.label).toBe('verification-code');
    expect(() =>
      verifyRequest(card.secret.request, { pinnedFingerprint: identity.identityKeyFp }),
    ).not.toThrow();

    const envelope = await sealSecret({ request: card.secret.request, secret: utf8Encode(CODE) });
    const res = await decide(parked.id, { action: 'fulfill', envelope });
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text).data.status).toBe('completed');
    expect(text).not.toContain(CODE);
    expect(holder.sent).toEqual([
      {
        message: expect.objectContaining({ text: `The confirmation code is ${CODE}` }),
        to: 'verify@bank.example',
      },
    ]);

    const [row] = await serverDB
      .select()
      .from(agentHumanRequests)
      .where(eq(agentHumanRequests.id, parked.id));
    expect(row.recipientKey).toBeNull();
    expect(JSON.stringify(row)).not.toContain(CODE);
    expect(holder.notified[0].prompt).not.toContain(CODE);

    // The same envelope can never be used twice.
    expect((await decide(parked.id, { action: 'fulfill', envelope })).status).toBe(409);
    expect(holder.sent).toHaveLength(1);
  });

  it('redacts a code a provider error echoes back', async () => {
    const parked = await (await park()).secret();
    const card = (await json(await call(`/human-requests/${parked.id}`, { key: OWNER_KEY }))).data;
    const envelope = await sealSecret({ request: card.secret.request, secret: utf8Encode(CODE) });

    holder.sendFails = true;
    const text = await (await decide(parked.id, { action: 'fulfill', envelope })).text();

    expect(text).not.toContain(CODE);
    expect(JSON.parse(text).data.result.error).toContain('«secret:verification-code»');
  });

  it('keeps cards private to their owner and out of reach of restricted API keys', async () => {
    const parked = await (await park()).approval();

    expect((await call(`/human-requests/${parked.id}`, { key: STRANGER_KEY })).status).toBe(404);
    expect(
      (await json(await call('/human-requests', { key: STRANGER_KEY }))).data.requests,
    ).toEqual([]);
    expect((await decide(parked.id, { action: 'approve' }, STRANGER_KEY)).status).toBe(404);

    const restricted = await decide(parked.id, { action: 'approve' }, RESTRICTED_KEY);
    expect(restricted.status).toBe(403);
    expect(holder.sent).toHaveLength(0);

    // A restricted key with agent:read may read the cards ...
    expect((await call(`/human-requests/${parked.id}`, { key: RESTRICTED_KEY })).status).toBe(200);
    // ... but one without it reads none of them: the action text is private.
    expect((await call('/human-requests', { key: NO_AGENT_READ_KEY })).status).toBe(403);
    expect((await call(`/human-requests/${parked.id}`, { key: NO_AGENT_READ_KEY })).status).toBe(
      403,
    );
  });

  it('rejects a plaintext secret smuggled into the decision body', async () => {
    const parked = await (await park()).secret();

    const res = await decide(parked.id, { action: 'fulfill', secret: CODE });

    expect(res.status).toBe(400);
    expect(holder.sent).toHaveLength(0);
  });
});
