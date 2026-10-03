// @vitest-environment node
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end evidence run for the agent-account control plane.
 *
 * Real `AgentRoutes` (the same module `app.ts` registers), real
 * `userAuthMiddleware` + `workspaceAuthMiddleware` + permission/scope
 * middleware, real controller, real `AgentAccountRestService`, real
 * `AgentAccountService`, the real Drizzle model on PGlite, and the real AES-GCM
 * KeyVaults gatekeeper. The app shell is assembled from those exact modules
 * rather than importing `app.ts`, because `app.ts` pulls the whole route graph
 * (and its model-bank/global-config imports) which this package's vitest alias
 * map does not resolve; nothing under test is replaced. The only stand-in is
 * the identity *provider* SaaS, which operations has not provisioned yet — so
 * this test mounts accounts through the `user` provider instead of calling
 * lobe.id / Linq.
 *
 * What it pins down:
 * - the collection / item / credential / revoke routes exist and answer the
 *   documented status codes through the real auth + scope stack;
 * - installing a credential is a *separate* scope (`agent:credential:write`):
 *   an `agent:write` key is refused with `insufficient_scope`;
 * - the credential is write-only end to end — the response reports the hint and
 *   `hasCredential`, the column holds ciphertext, and no read ever returns it;
 * - an account is only reachable under the agent that owns it.
 */
// Same env bootstrap `scripts/generate-openapi.ts` uses: dummy secrets satisfy
// import-time env validation without touching real infrastructure.
// (`NODE_ENV` is typed read-only, hence `Object.assign`.)
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');
process.env.CLOUD_DATABASE_URL ??= 'postgresql://mock:mock@localhost:5432/mock';
process.env.QSTASH_TOKEN ??= 'mock-qstash-token';

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, agentAccounts, apiKeys, users } = await import('@/database/schemas');
const { AgentAccountModel } = await import('@/database/models/agentAccount');
const { hashApiKey } = await import('@lobechat/utils/server');
const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const AgentRoutes = (await import('./agents.route')).default;
const { eq } = await import('drizzle-orm');

const serverDB = await getTestDB();
holder.serverDB = serverDB;

/**
 * The deployed shell for this resource: same global auth middlewares, same
 * routes, mounted under the same `/api/v1/agents` path `app.ts` uses.
 */
const app = new Hono().basePath('/api/v1');
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/agents', AgentRoutes);

const OWNER = 't594-control-owner';
const STRANGER = 't594-control-stranger';
const AGENT = 't594-control-agent';
const STRANGER_AGENT = 't594-control-stranger-agent';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const CREDENTIAL_KEY = 'sk-lh-t594credfull0001';
const AGENT_ONLY_KEY = 'sk-lh-t594crednone0001';
const STRANGER_KEY = 'sk-lh-t594stranger0001';

const SECRET = 's3cret-passphrase-do-not-log';

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

let gateKeeper: Awaited<ReturnType<typeof KeyVaultsGateKeeper.initWithEnvKey>>;

beforeAll(async () => {
  gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
});

beforeEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(apiKeys);
  await serverDB.delete(agents);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(agents).values([
    { id: AGENT, userId: OWNER },
    { id: STRANGER_AGENT, userId: STRANGER },
  ]);
  await serverDB.insert(apiKeys).values([
    {
      key: CREDENTIAL_KEY,
      keyHash: hashApiKey(CREDENTIAL_KEY),
      name: 't594 credential writer',
      scopes: ['agent:read', 'agent:write', 'agent:credential:write'],
      userId: OWNER,
    },
    {
      key: AGENT_ONLY_KEY,
      keyHash: hashApiKey(AGENT_ONLY_KEY),
      name: 't594 agent writer without credential scope',
      scopes: ['agent:read', 'agent:write'],
      userId: OWNER,
    },
    {
      key: STRANGER_KEY,
      keyHash: hashApiKey(STRANGER_KEY),
      name: 't594 other account',
      scopes: ['agent:read', 'agent:write', 'agent:credential:write'],
      userId: STRANGER,
    },
  ]);
});

afterAll(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(apiKeys);
  await serverDB.delete(agents);
  await serverDB.delete(users);
});

const mountAccount = async (key = CREDENTIAL_KEY) => {
  const res = await call(`/agents/${AGENT}/accounts`, {
    body: JSON.stringify({
      capabilities: { login: true, receive: false, send: false },
      displayName: 'GitHub login',
      identifier: 'agent@github',
      kind: 'service',
      provider: 'user',
    }),
    key,
    method: 'POST',
  });
  return { body: await json(res), res };
};

describe('agent account control plane — end to end', () => {
  it('drives mount → list → credential → revoke over real HTTP', async () => {
    const transcript: string[] = [];

    // 1. Mount an account the caller already holds the handle for.
    const { body: created, res: createRes } = await mountAccount();
    expect(createRes.status).toBe(201);
    const id: string = created.data.id;
    transcript.push(
      `1. POST /agents/${AGENT}/accounts -> ${createRes.status} id=${id} kind=${created.data.kind} provider=${created.data.provider} hasCredential=${created.data.hasCredential}`,
    );
    expect(created.data).toMatchObject({
      agentId: AGENT,
      hasCredential: false,
      identifier: 'agent@github',
      kind: 'service',
      provider: 'user',
      status: 'provisioning',
    });
    expect(created.data).not.toHaveProperty('credentials');

    // 2. The list is an inventory, not a place to hand out secrets.
    const listRes = await call(`/agents/${AGENT}/accounts`, { key: CREDENTIAL_KEY });
    expect(listRes.status).toBe(200);
    const listed = await json(listRes);
    transcript.push(
      `2. GET /agents/${AGENT}/accounts -> ${listRes.status} total=${listed.data.total} exposesCredentials=${JSON.stringify(listed).includes('credentials')}`,
    );
    expect(listed.data.total).toBe(1);
    expect(listed.data.accounts[0]).not.toHaveProperty('credentials');

    // 3. An `agent:write` key may manage accounts but NOT install a credential.
    const refused = await call(`/agents/${AGENT}/accounts/${id}/credential`, {
      body: JSON.stringify({ credential: { password: SECRET } }),
      key: AGENT_ONLY_KEY,
      method: 'PUT',
    });
    const refusedBody = await refused.text();
    transcript.push(
      `3. PUT .../credential as key[agent:read,agent:write] -> ${refused.status} ${refusedBody}`,
    );
    expect(refused.status).toBe(403);
    expect(refusedBody).toContain('agent:credential:write');

    // ...and nothing was written.
    const [untouched] = await serverDB
      .select({ credentials: agentAccounts.credentials })
      .from(agentAccounts)
      .where(eq(agentAccounts.id, id));
    expect(untouched.credentials).toBeNull();

    // 4. A key holding the dedicated credential scope succeeds — write-only.
    const written = await call(`/agents/${AGENT}/accounts/${id}/credential`, {
      body: JSON.stringify({
        credential: { password: SECRET },
        hint: { username: 'agent@github' },
      }),
      key: CREDENTIAL_KEY,
      method: 'PUT',
    });
    expect(written.status).toBe(200);
    const writtenBody = await json(written);
    transcript.push(
      `4. PUT .../credential as key[+agent:credential:write] -> ${written.status} hasCredential=${writtenBody.data.hasCredential} hint=${JSON.stringify(writtenBody.data.credentialHint)} secretInResponse=${JSON.stringify(writtenBody).includes(SECRET)}`,
    );
    expect(writtenBody.data).toMatchObject({
      hasCredential: true,
      credentialHint: { username: 'agent@github' },
    });
    // The secret never comes back, not even on the write that installed it.
    expect(JSON.stringify(writtenBody)).not.toContain(SECRET);
    expect(writtenBody.data).not.toHaveProperty('credentials');
    expect(writtenBody.data.credentialHint).not.toHaveProperty('password');

    // 5. The column holds AES-GCM ciphertext, and only the internal read decrypts.
    const [row] = await serverDB
      .select({ credentials: agentAccounts.credentials })
      .from(agentAccounts)
      .where(eq(agentAccounts.id, id));
    const decrypted = await new AgentAccountModel(serverDB, OWNER, gateKeeper).getCredential(id);
    transcript.push(
      `5. agent_accounts.credentials -> ${String(row.credentials).slice(0, 24)}… plaintextLeaked=${String(row.credentials).includes(SECRET)} decryptMatches=${decrypted?.password === SECRET}`,
    );
    expect(row.credentials).toBeTruthy();
    expect(row.credentials).not.toContain(SECRET);
    expect(decrypted).toEqual({ password: SECRET });

    // 6. A read still returns the hint, never the secret.
    const detailRes = await call(`/agents/${AGENT}/accounts/${id}`, { key: CREDENTIAL_KEY });
    const detail = await json(detailRes);
    transcript.push(
      `6. GET .../accounts/${id} -> ${detailRes.status} hasCredential=${detail.data.hasCredential} secretInResponse=${JSON.stringify(detail).includes(SECRET)}`,
    );
    expect(detail.data.hasCredential).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(SECRET);

    // 7. An account is only reachable under the agent that owns it.
    const crossAgent = await call(`/agents/${STRANGER_AGENT}/accounts/${id}`, {
      key: CREDENTIAL_KEY,
    });
    transcript.push(`7. GET a foreign agent's path for this account -> ${crossAgent.status}`);
    expect(crossAgent.status).toBe(404);

    // 8. Another user's key cannot even see the agent.
    const stranger = await call(`/agents/${AGENT}/accounts`, { key: STRANGER_KEY });
    transcript.push(`8. GET the owner's agent as another user -> ${stranger.status}`);
    expect(stranger.status).toBe(404);

    // 9. Revoke releases the identity and purges the secret.
    const revoked = await call(`/agents/${AGENT}/accounts/${id}`, {
      key: CREDENTIAL_KEY,
      method: 'DELETE',
    });
    const revokedBody = await json(revoked);
    expect(revoked.status).toBe(200);
    expect(revokedBody.data).toMatchObject({ hasCredential: false, status: 'revoked' });
    const [afterRevoke] = await serverDB
      .select({ credentials: agentAccounts.credentials })
      .from(agentAccounts)
      .where(eq(agentAccounts.id, id));
    transcript.push(
      `9. DELETE .../accounts/${id} -> ${revoked.status} status=${revokedBody.data.status} hasCredential=${revokedBody.data.hasCredential} columnCleared=${afterRevoke.credentials === null}`,
    );
    expect(afterRevoke.credentials).toBeNull();

    console.log(`\n[agent-account-control-plane]\n${transcript.join('\n')}\n`);
  });

  it('treats duplicate mounts as a conflict rather than a second identity', async () => {
    const first = await mountAccount();
    expect(first.res.status).toBe(201);

    const second = await mountAccount();
    expect(second.res.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('already bound to another agent');
  });

  it('rejects an unknown provider so a typo cannot silently create an empty account', async () => {
    const res = await call(`/agents/${AGENT}/accounts`, {
      body: JSON.stringify({ provider: 'not-a-provider' }),
      key: CREDENTIAL_KEY,
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('not-a-provider');
  });
});
