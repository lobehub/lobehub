// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentQuotaService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'agent-quota-visibility-owner';
const teammateId = 'agent-quota-visibility-teammate';
const workspaceId = 'agent-quota-visibility-ws';
const identity = { email: 'owner@example.com', externalAccountId: 'acc-private-1' };
const reading = (utilization: number) => ({
  capturedAt: Date.now(),
  limitType: 'session',
  resetsAt: Date.now() + 3_600_000,
  scopeKey: '',
  utilization,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: teammateId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Quota visibility',
    primaryOwnerId: ownerId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentQuotaService private workspace accounts', () => {
  it("keeps another member's private account and its readings out of a teammate's reach", async () => {
    const owner = new AgentQuotaService(serverDB, ownerId, workspaceId);
    const teammate = new AgentQuotaService(serverDB, teammateId, workspaceId);

    const account = (await owner.ingestSnapshot({
      identity,
      provider: 'claude-code',
      readings: [reading(40)],
    }))!;
    expect(account.visibility).toBe('private');

    // A report of the same identity neither returns the row nor lands readings in it.
    await expect(
      teammate.ingestSnapshot({ identity, provider: 'claude-code', readings: [reading(99)] }),
    ).resolves.toBeUndefined();
    expect((await owner.listLatestReadings(account.id)).map((r) => r.utilization)).toEqual([40]);

    // Loads are derived from readings, so they follow the account's visibility.
    await expect(teammate.resolveAccountLoads([account.id])).resolves.toEqual([]);
    await expect(owner.resolveAccountLoads([account.id])).resolves.toHaveLength(1);
  });
});
