// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'agent-account-routing-user';
const agentId = 'agent-account-routing-agent';

const gateKeeper = {
  decrypt: async (ciphertext: string) => ({ plaintext: ciphertext }),
  encrypt: async (plaintext: string) => plaintext,
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(agents);
  await serverDB.delete(users);
});

const createAccount = async (identifier: string) =>
  new AgentAccountModel(serverDB, userId, gateKeeper).create({
    agentId,
    capabilities: { receive: true, send: true },
    identifier,
    kind: 'mail',
    provider: 'agent-mail',
  });

describe('AgentAccountModel.isRoutingKeyHeld', () => {
  it('reports a handle a live account still routes on', async () => {
    await createAccount('held@lobe.id');

    expect(await AgentAccountModel.isRoutingKeyHeld(serverDB, 'agent-mail', 'held@lobe.id')).toBe(
      true,
    );
  });

  it('releases the handle once the account is revoked', async () => {
    const model = new AgentAccountModel(serverDB, userId, gateKeeper);
    const created = await createAccount('released@lobe.id');

    await model.revoke(created.id);

    expect(
      await AgentAccountModel.isRoutingKeyHeld(serverDB, 'agent-mail', 'released@lobe.id'),
    ).toBe(false);
  });

  it('reports a handle nobody holds', async () => {
    expect(await AgentAccountModel.isRoutingKeyHeld(serverDB, 'agent-mail', 'free@lobe.id')).toBe(
      false,
    );
    // Same handle, different provider: the key is the pair.
    await createAccount('paired@lobe.id');
    expect(await AgentAccountModel.isRoutingKeyHeld(serverDB, 'other-mail', 'paired@lobe.id')).toBe(
      false,
    );
  });
});
