// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Same env bootstrap the route test uses: dummy secrets satisfy import-time env
// validation without touching real infrastructure.
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const { getTestDB } = await import('@/database/core/getTestDB');
const { agentAccounts, agents, users, workspaces } = await import('@/database/schemas');
const { AgentAccountModel } = await import('@/database/models/agentAccount');
const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');
const { AgentAccountRestService } = await import('../agent-account.service');

const serverDB = await getTestDB();

const WORKSPACE = 'agent-account-rest-ws';
const OWNER = 'agent-account-rest-owner';
const MEMBER = 'agent-account-rest-member';
const PRIVATE_AGENT = 'agent-account-rest-private-agent';

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: OWNER }, { id: MEMBER }]);
  await serverDB
    .insert(workspaces)
    .values({ id: WORKSPACE, name: WORKSPACE, primaryOwnerId: OWNER, slug: WORKSPACE });
  await serverDB
    .insert(agents)
    .values({ id: PRIVATE_AGENT, userId: OWNER, visibility: 'private', workspaceId: WORKSPACE });
});

afterEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(agents);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('AgentAccountRestService workspace isolation', () => {
  it("answers 404 for every item route on a colleague's private agent account", async () => {
    const owner = new AgentAccountModel(
      serverDB,
      OWNER,
      await KeyVaultsGateKeeper.initWithEnvKey(),
      WORKSPACE,
    );
    const account = await owner.create({
      agentId: PRIVATE_AGENT,
      capabilities: { receive: true, send: true },
      credential: { apiKey: 'owner-secret' },
      identifier: 'private@lobe.id',
      kind: 'mail',
      provider: 'user',
    });

    const member = new AgentAccountRestService(serverDB, MEMBER, WORKSPACE);
    const notFound = { name: 'NotFoundError' };

    await expect(member.listAccounts(PRIVATE_AGENT, {})).rejects.toMatchObject(notFound);
    await expect(member.getAccount(PRIVATE_AGENT, account.id)).rejects.toMatchObject(notFound);
    await expect(
      member.updateAccount(PRIVATE_AGENT, account.id, { displayName: 'hijacked' }),
    ).rejects.toMatchObject(notFound);
    await expect(
      member.setCredential(PRIVATE_AGENT, account.id, { credential: { apiKey: 'stolen' } }),
    ).rejects.toMatchObject(notFound);
    await expect(member.revokeAccount(PRIVATE_AGENT, account.id, {})).rejects.toMatchObject(
      notFound,
    );

    // Nothing moved: the owner still holds the original account and secret.
    expect(await owner.findById(account.id)).toMatchObject({
      displayName: null,
      status: 'provisioning',
    });
    expect(await owner.getCredential(account.id)).toEqual({ apiKey: 'owner-secret' });
  });
});
