// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-account-test-user-id';
const userId2 = 'agent-account-test-user-id-2';
const agentId = 'agent-account-test-agent-id';
const agentId2 = 'agent-account-test-agent-id-2';

const mockGateKeeper = {
  decrypt: vi.fn(async (ciphertext: string) => ({ plaintext: ciphertext })),
  encrypt: vi.fn(async (plaintext: string) => plaintext),
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: agentId2, userId: userId2 },
  ]);
});

afterEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(agents);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

const seedWorkspace = async (id: string) => {
  await serverDB
    .insert(workspaces)
    .values({ id, name: id, primaryOwnerId: userId, slug: id })
    .onConflictDoNothing();

  return id;
};

/** A minimal mail account, with per-test identifier overrides. */
const mailAccount = (identifier = 'agent@lobe.id') => ({
  agentId,
  capabilities: { receive: true, send: true },
  identifier,
  kind: 'mail' as const,
  provider: 'agent-mail',
});

describe('AgentAccountModel credential discipline', () => {
  it('returns hasCredential but never the ciphertext', async () => {
    const model = new AgentAccountModel(serverDB, userId, mockGateKeeper);

    const created = await model.create({
      ...mailAccount('discipline@lobe.id'),
      credential: { webhookSecret: 'whsec_abc' },
    });

    expect(created.hasCredential).toBe(true);
    expect(created).not.toHaveProperty('credentials');

    const listed = await model.query({ agentId });
    expect(listed[0].hasCredential).toBe(true);
    expect(listed[0]).not.toHaveProperty('credentials');

    const found = await model.findById(created.id);
    expect(found!.hasCredential).toBe(true);
    expect(found).not.toHaveProperty('credentials');
  });

  it('stores the credential as ciphertext through the gatekeeper', async () => {
    const model = new AgentAccountModel(serverDB, userId, mockGateKeeper);

    await model.create({
      ...mailAccount('cipher@lobe.id'),
      credential: { webhookSecret: 'whsec_abc' },
    });

    expect(mockGateKeeper.encrypt).toHaveBeenCalledWith(
      JSON.stringify({ webhookSecret: 'whsec_abc' }),
    );
  });

  it('refuses to store a credential without a gatekeeper, with an actionable message', async () => {
    const model = new AgentAccountModel(serverDB, userId);

    await expect(
      model.create({ ...mailAccount('nogk@lobe.id'), credential: { webhookSecret: 'x' } }),
    ).rejects.toThrow(/needs a gatekeeper to store credentials/);
  });

  it('exposes the credential only through getCredential', async () => {
    const model = new AgentAccountModel(serverDB, userId, mockGateKeeper);
    const created = await model.create({
      ...mailAccount('getcred@lobe.id'),
      credential: { apiKey: 'am_123' },
    });

    await expect(model.getCredential(created.id)).resolves.toEqual({ apiKey: 'am_123' });
  });

  it('returns null from getCredential for an account without one', async () => {
    const model = new AgentAccountModel(serverDB, userId, mockGateKeeper);
    const created = await model.create(mailAccount('nocred@lobe.id'));

    expect(created.hasCredential).toBe(false);
    await expect(model.getCredential(created.id)).resolves.toBeNull();
  });

  it('stamps rotatedAt and replaces the secret on setCredential', async () => {
    const model = new AgentAccountModel(serverDB, userId, mockGateKeeper);
    const created = await model.create({
      ...mailAccount('rotate@lobe.id'),
      credential: { apiKey: 'am_old' },
    });

    await model.setCredential(created.id, { apiKey: 'am_new' }, { masked: '•••• new' });

    const found = await model.findById(created.id);
    expect(found!.credentialHint).toMatchObject({ masked: '•••• new' });
    expect(found!.credentialHint?.rotatedAt).toBeTruthy();
    await expect(model.getCredential(created.id)).resolves.toEqual({ apiKey: 'am_new' });
  });

  it('purges the credential when revoking, unless asked to keep it', async () => {
    const model = new AgentAccountModel(serverDB, userId, mockGateKeeper);
    const purged = await model.create({
      ...mailAccount('revoke-purge@lobe.id'),
      credential: { apiKey: 'am_1' },
    });
    const kept = await model.create({
      ...mailAccount('revoke-keep@lobe.id'),
      credential: { apiKey: 'am_2' },
    });

    await model.revoke(purged.id);
    await model.revoke(kept.id, { purgeCredential: false });

    const purgedRow = await model.findById(purged.id);
    expect(purgedRow!.status).toBe('revoked');
    expect(purgedRow!.revokedAt).toBeTruthy();
    expect(purgedRow!.hasCredential).toBe(false);
    expect(purgedRow!.credentialHint).toBeNull();

    const keptRow = await model.findById(kept.id);
    expect(keptRow!.status).toBe('revoked');
    expect(keptRow!.hasCredential).toBe(true);
  });
});

describe('AgentAccountModel workspace isolation by agent visibility', () => {
  const workspaceId = 'agent-account-visibility-ws';
  const privateAgentId = 'agent-account-private-ws-agent';
  const publicAgentId = 'agent-account-public-ws-agent';

  beforeEach(async () => {
    await seedWorkspace(workspaceId);
    await serverDB.insert(agents).values([
      { id: privateAgentId, userId, visibility: 'private', workspaceId },
      { id: publicAgentId, userId, visibility: 'public', workspaceId },
    ]);
  });

  /** user1 owns both agents; user2 is a fellow member of the same workspace. */
  const seedAccounts = async () => {
    const owner = new AgentAccountModel(serverDB, userId, mockGateKeeper, workspaceId);
    const privateAccount = await owner.create({
      ...mailAccount('private-agent@lobe.id'),
      agentId: privateAgentId,
      credential: { webhookSecret: 'whsec_private' },
    });
    const publicAccount = await owner.create({
      ...mailAccount('public-agent@lobe.id'),
      agentId: publicAgentId,
    });

    return { owner, privateAccount, publicAccount };
  };

  it('hides a private agent account from another workspace member', async () => {
    const { owner, privateAccount, publicAccount } = await seedAccounts();
    const member = new AgentAccountModel(serverDB, userId2, mockGateKeeper, workspaceId);

    expect(await member.findById(privateAccount.id)).toBeUndefined();
    expect(await member.getCredential(privateAccount.id)).toBeNull();
    expect((await member.query()).map((a) => a.id)).toEqual([publicAccount.id]);
    expect(await member.query({ agentId: privateAgentId })).toHaveLength(0);

    // The owner still sees both.
    expect(await owner.query()).toHaveLength(2);
  });

  it('refuses a member update / setCredential / revoke on a private agent account', async () => {
    const { owner, privateAccount } = await seedAccounts();
    const member = new AgentAccountModel(serverDB, userId2, mockGateKeeper, workspaceId);

    expect(await member.update(privateAccount.id, { displayName: 'hijacked' })).toBeUndefined();
    expect(await member.setCredential(privateAccount.id, { webhookSecret: 'x' })).toBeUndefined();
    expect(await member.revoke(privateAccount.id)).toBeUndefined();

    const intact = await owner.findById(privateAccount.id);
    expect(intact).toMatchObject({
      displayName: null,
      hasCredential: true,
      status: 'provisioning',
    });
    expect(await owner.getCredential(privateAccount.id)).toEqual({
      webhookSecret: 'whsec_private',
    });
  });

  it('lets a member use the account of a public agent', async () => {
    const { publicAccount } = await seedAccounts();
    const member = new AgentAccountModel(serverDB, userId2, mockGateKeeper, workspaceId);

    expect(await member.findById(publicAccount.id)).toMatchObject({ id: publicAccount.id });
    expect(await member.update(publicAccount.id, { displayName: 'shared' })).toBe(publicAccount.id);
  });
});

describe('AgentAccountModel scope and writes', () => {
  it('does not expose another user account', async () => {
    const model1 = new AgentAccountModel(serverDB, userId);
    const model2 = new AgentAccountModel(serverDB, userId2);

    const created = await model1.create(mailAccount('private@lobe.id'));

    expect(await model2.findById(created.id)).toBeUndefined();
    expect(await model2.query()).toHaveLength(0);
  });

  it('does not let another user patch or revoke an account', async () => {
    const model1 = new AgentAccountModel(serverDB, userId);
    const model2 = new AgentAccountModel(serverDB, userId2);
    const created = await model1.create(mailAccount('iso@lobe.id'));

    await model2.update(created.id, { displayName: 'hijacked' });
    await model2.revoke(created.id);

    const found = await model1.findById(created.id);
    expect(found!.displayName).toBeNull();
    expect(found!.status).toBe('provisioning');
  });

  it('resolves an account from the routing key across every scope', async () => {
    const workspaceId = await seedWorkspace('agent-account-routing-ws');
    const inWorkspace = new AgentAccountModel(serverDB, userId, undefined, workspaceId);
    await inWorkspace.create(mailAccount('routing@lobe.id'));

    // Personal scope cannot see it…
    const personal = new AgentAccountModel(serverDB, userId);
    expect(await personal.query()).toHaveLength(0);

    // …but an inbound webhook resolves it by (provider, identifier).
    const route = await AgentAccountModel.findByRoutingKey(
      serverDB,
      'agent-mail',
      'routing@lobe.id',
    );
    expect(route?.workspaceId).toBe(workspaceId);
    expect(route?.hasCredential).toBe(false);
  });

  it('routes a rebound handle to the live account, never the revoked one', async () => {
    const original = new AgentAccountModel(serverDB, userId, mockGateKeeper);
    const revoked = await original.create({
      ...mailAccount('rebind@lobe.id'),
      credential: { webhookSecret: 'whsec_old_owner' },
    });
    // Keep the old credential so a wrong resolution would verify with it.
    await original.revoke(revoked.id, { purgeCredential: false });

    const replacement = new AgentAccountModel(serverDB, userId2, mockGateKeeper);
    const live = await replacement.create({
      ...mailAccount('rebind@lobe.id'),
      agentId: agentId2,
      credential: { webhookSecret: 'whsec_new_owner' },
    });

    const route = await AgentAccountModel.findByRoutingKey(
      serverDB,
      'agent-mail',
      'rebind@lobe.id',
    );
    expect(route?.id).toBe(live.id);

    const inbound = await AgentAccountModel.findForInboundVerification(
      serverDB,
      'agent-mail',
      'rebind@lobe.id',
      mockGateKeeper,
    );
    expect(inbound?.view.id).toBe(live.id);
    expect(inbound?.credential).toEqual({ webhookSecret: 'whsec_new_owner' });
  });

  it('does not route a revoked handle that nothing has rebound', async () => {
    const model = new AgentAccountModel(serverDB, userId);
    const created = await model.create(mailAccount('released@lobe.id'));
    await model.revoke(created.id);

    expect(
      await AgentAccountModel.findByRoutingKey(serverDB, 'agent-mail', 'released@lobe.id'),
    ).toBeUndefined();
  });

  it('decrypts for inbound signature verification, and only with a gatekeeper', async () => {
    const model = new AgentAccountModel(serverDB, userId, mockGateKeeper);
    await model.create({
      ...mailAccount('verify@lobe.id'),
      credential: { webhookSecret: 'whsec_verify' },
    });

    const withGatekeeper = await AgentAccountModel.findForInboundVerification(
      serverDB,
      'agent-mail',
      'verify@lobe.id',
      mockGateKeeper,
    );
    expect(withGatekeeper?.credential).toEqual({ webhookSecret: 'whsec_verify' });

    const withoutGatekeeper = await AgentAccountModel.findForInboundVerification(
      serverDB,
      'agent-mail',
      'verify@lobe.id',
    );
    expect(withoutGatekeeper).toBeUndefined();
  });

  it('stops routing inbound once an account is released', async () => {
    const model = new AgentAccountModel(serverDB, userId, mockGateKeeper);
    const created = await model.create({
      ...mailAccount('released@lobe.id'),
      credential: { webhookSecret: 'whsec_released' },
    });

    // Live: the webhook resolves the account and can decrypt its credential.
    await expect(
      AgentAccountModel.findForInboundVerification(
        serverDB,
        'agent-mail',
        'released@lobe.id',
        mockGateKeeper,
      ),
    ).resolves.toMatchObject({ credential: { webhookSecret: 'whsec_released' } });

    await model.revoke(created.id);

    // Released: a delivery addressed to the same handle must no longer resolve.
    // Revocation that stops sending but keeps receiving is not a release.
    await expect(
      AgentAccountModel.findForInboundVerification(
        serverDB,
        'agent-mail',
        'released@lobe.id',
        mockGateKeeper,
      ),
    ).resolves.toBeUndefined();
  });

  it('stops routing inbound while an account is suspended', async () => {
    const model = new AgentAccountModel(serverDB, userId);
    const created = await model.create(mailAccount('suspended@lobe.id'));

    await model.update(created.id, { status: 'suspended' });

    await expect(
      AgentAccountModel.findForInboundVerification(serverDB, 'agent-mail', 'suspended@lobe.id'),
    ).resolves.toBeUndefined();
  });

  it('keeps one account per (agent, kind, provider, identifier)', async () => {
    const model = new AgentAccountModel(serverDB, userId);
    await model.create(mailAccount('dupe@lobe.id'));

    await expect(model.create(mailAccount('dupe@lobe.id'))).rejects.toThrow();
  });
});

describe('AgentAccountModel schema invariants', () => {
  it('gets a database-generated uuid id, not a prefixed nanoid', async () => {
    const model = new AgentAccountModel(serverDB, userId);
    const created = await model.create(mailAccount('uuid@lobe.id'));

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('requires capabilities to be stated instead of silently defaulting to "does nothing"', async () => {
    // The column is NOT NULL with no default on purpose: a producer that cannot
    // say what the account does has not finished provisioning it, and a silent
    // `{ receive: false, send: false }` would install a dead account that looks
    // healthy. Insert without the column and let the database refuse the row —
    // if a default is ever reintroduced, this insert starts succeeding.
    await expect(
      serverDB.execute(
        sql`INSERT INTO agent_accounts (agent_id, user_id, kind, identifier, provider)
            VALUES (${agentId}, ${userId}, 'mail', 'nocaps@lobe.id', 'agent-mail')`,
      ),
    ).rejects.toThrow();
  });
});
