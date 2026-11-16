// Drag-and-drop order of the sidebar's `pinned` bucket: the team order lives
// on the workspace, the personal order on the user's preference.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import * as Schema from '../../../schemas';
import { HomeRepository } from '../index';

const clientDB = await getTestDB();

const owner = 'u-pin-order-owner';
const ws = 'ws-pin-order';

const createPinned = async (model: AgentModel, title: string) => {
  const agent = await model.create({ systemRole: '', title, visibility: 'public' } as any);
  await model.update(agent.id, { pinned: true });
  return agent.id;
};

beforeEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
  await clientDB
    .insert(Schema.users)
    .values([{ id: owner, preference: { sidebarHiddenAgentIds: ['kept'] } }]);
  await clientDB.insert(Schema.workspaces).values({
    id: ws,
    name: 'WS',
    primaryOwnerId: owner,
    settings: { apiKey: { memberCreation: 'admins_only' }, sidebar: { other: true } },
    slug: 'ws-pin-order',
  });
});

afterEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
});

describe('HomeRepository pinned order', () => {
  it('lays out workspace team pins in the saved order, new pins first', async () => {
    const model = new AgentModel(clientDB, owner, ws);
    const a = await createPinned(model, 'A');
    const b = await createPinned(model, 'B');
    const c = await createPinned(model, 'C');
    const repo = new HomeRepository(clientDB, owner, ws);

    await repo.updatePinnedOrder([a, c, b]);
    expect((await repo.getSidebarAgentList()).pinned.map((item) => item.id)).toEqual([a, c, b]);

    const d = await createPinned(model, 'D');
    expect((await repo.getSidebarAgentList()).pinned.map((item) => item.id)).toEqual([d, a, c, b]);
  });

  it('stores the team order on the workspace without touching other settings', async () => {
    const repo = new HomeRepository(clientDB, owner, ws);

    await repo.updatePinnedOrder(['x', 'y', 'x']);

    expect(await repo.getPinnedOrder()).toEqual(['x', 'y']);
    const [row] = await clientDB
      .select({ settings: Schema.workspaces.settings })
      .from(Schema.workspaces)
      .where(eq(Schema.workspaces.id, ws));
    expect(row.settings).toEqual({
      apiKey: { memberCreation: 'admins_only' },
      sidebar: { other: true, teamPinnedOrder: ['x', 'y'] },
    });
    // The personal order is a separate list.
    expect(await new HomeRepository(clientDB, owner).getPinnedOrder()).toEqual([]);
  });

  it('keeps the personal order on the user preference', async () => {
    const model = new AgentModel(clientDB, owner);
    const a = await createPinned(model, 'A');
    const b = await createPinned(model, 'B');
    const repo = new HomeRepository(clientDB, owner);

    await repo.updatePinnedOrder([a, b]);
    expect((await repo.getSidebarAgentList()).pinned.map((item) => item.id)).toEqual([a, b]);

    await repo.updatePinnedOrder([b, a]);
    expect((await repo.getSidebarAgentList()).pinned.map((item) => item.id)).toEqual([b, a]);

    const [row] = await clientDB
      .select({ preference: Schema.users.preference })
      .from(Schema.users)
      .where(eq(Schema.users.id, owner));
    expect(row.preference).toEqual({ sidebarHiddenAgentIds: ['kept'], sidebarPinnedOrder: [b, a] });
    // The workspace team order is untouched.
    expect(await new HomeRepository(clientDB, owner, ws).getPinnedOrder()).toEqual([]);
  });
});
