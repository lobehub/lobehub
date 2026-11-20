// @vitest-environment node
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 'bound-device-user-a';
const userB = 'bound-device-user-b';

let workspaceId = '';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
  const [ws] = await serverDB
    .insert(workspaces)
    .values({ name: 'bound-device-ws', primaryOwnerId: userA, slug: 'bound-device-ws' })
    .returning();
  workspaceId = ws.id;
});

afterEach(async () => {
  await serverDB.delete(users);
});

const insertAgent = (params: {
  agencyConfig?: LobeAgentAgencyConfig;
  id: string;
  userId: string;
  visibility?: 'private' | 'public';
  workspaceId?: string;
}) =>
  serverDB.insert(agents).values({
    agencyConfig: params.agencyConfig,
    id: params.id,
    title: params.id,
    userId: params.userId,
    visibility: params.visibility ?? 'public',
    workspaceId: params.workspaceId ?? null,
  });

describe('AgentModel.queryBoundToDevice', () => {
  it('returns agents whose device or local target is bound to the device', async () => {
    await insertAgent({
      agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'device' },
      id: 'a-device',
      userId: userA,
    });
    await insertAgent({
      agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'local' },
      id: 'a-local',
      userId: userA,
    });
    // A stale binding left behind after switching to the sandbox no longer routes here.
    await insertAgent({
      agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'sandbox' },
      id: 'a-sandbox',
      userId: userA,
    });
    await insertAgent({
      agencyConfig: { boundDeviceId: 'device-b', executionTarget: 'device' },
      id: 'a-other-device',
      userId: userA,
    });
    await insertAgent({ id: 'a-unbound', userId: userA });
    await insertAgent({
      agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'device' },
      id: 'b-device',
      userId: userB,
    });

    const rows = await new AgentModel(serverDB, userA).queryBoundToDevice('device-a');

    expect(rows.map((row) => row.id).sort()).toEqual(['a-device', 'a-local']);
    expect(rows[0]).toMatchObject({ backgroundColor: null, name: null, visibility: 'public' });
  });

  it("adds override-bound agents but never another member's private agent", async () => {
    await insertAgent({ id: 'ws-public', userId: userA, workspaceId });
    await insertAgent({ id: 'ws-private-a', userId: userA, visibility: 'private', workspaceId });
    await insertAgent({
      agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'device' },
      id: 'ws-private-a-bound',
      userId: userA,
      visibility: 'private',
      workspaceId,
    });
    await insertAgent({
      agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'device' },
      id: 'ws-shared-bound',
      userId: userA,
      workspaceId,
    });

    const rows = await new AgentModel(serverDB, userB, workspaceId).queryBoundToDevice('device-a', [
      'ws-public',
      'ws-private-a',
    ]);

    expect(rows.map((row) => row.id).sort()).toEqual(['ws-public', 'ws-shared-bound']);
  });
});

describe('AgentModel.queryAgencyRoutingByIds', () => {
  it('returns the routing config of the requested agents in one read', async () => {
    await insertAgent({
      agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'device' },
      id: 'a-device',
      userId: userA,
    });
    await insertAgent({ id: 'a-unbound', userId: userA });
    await insertAgent({ id: 'a-not-requested', userId: userA });

    const rows = await new AgentModel(serverDB, userA).queryAgencyRoutingByIds([
      'a-device',
      'a-unbound',
    ]);

    expect(rows.map((row) => row.id).sort()).toEqual(['a-device', 'a-unbound']);
    expect(rows.find((row) => row.id === 'a-device')?.agencyConfig).toEqual({
      boundDeviceId: 'device-a',
      executionTarget: 'device',
    });
  });

  it("drops an id the caller cannot see instead of leaking another member's private agent", async () => {
    await insertAgent({ id: 'ws-public', userId: userA, workspaceId });
    await insertAgent({ id: 'ws-private-a', userId: userA, visibility: 'private', workspaceId });

    const rows = await new AgentModel(serverDB, userB, workspaceId).queryAgencyRoutingByIds([
      'ws-public',
      'ws-private-a',
      'does-not-exist',
    ]);

    expect(rows.map((row) => row.id)).toEqual(['ws-public']);
  });

  it('short-circuits an empty request', async () => {
    expect(await new AgentModel(serverDB, userA).queryAgencyRoutingByIds([])).toEqual([]);
  });
});
