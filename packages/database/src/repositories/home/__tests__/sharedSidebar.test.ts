// Regression: the workspace sidebar skeleton is SHARED. Folders (Categories),
// their order, folder membership and pinning all live on the shared columns,
// so every member sees the same structure. The only per-member layer left is
// show/hide, which is applied client-side and never reaches this repository.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { SessionGroupModel } from '../../../models/sessionGroup';
import * as Schema from '../../../schemas';
import { HomeRepository } from '../index';

const clientDB = await getTestDB();

const memberA = 'u-member-a';
const memberB = 'u-member-b';
const ws = 'ws-shared-sidebar';

beforeEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
  await clientDB.insert(Schema.users).values([{ id: memberA }, { id: memberB }]);
  await clientDB.insert(Schema.workspaces).values({
    id: ws,
    name: 'WS',
    primaryOwnerId: memberA,
    slug: ws,
  });
});

afterEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
});

describe('shared workspace sidebar skeleton', () => {
  it('pins from the shared column surface for every member', async () => {
    const agentModel = new AgentModel(clientDB, memberA, ws);
    const agent = await agentModel.create({
      systemRole: '',
      title: 'Shared Agent',
      visibility: 'public',
    } as any);
    await agentModel.update(agent.id, { pinned: true });

    for (const member of [memberA, memberB]) {
      const view = await new HomeRepository(clientDB, member, ws).getSidebarAgentList();
      expect(view.pinned.map((a) => a.id)).toContain(agent.id);
      expect(view.ungrouped.map((a) => a.id)).not.toContain(agent.id);
    }
  });

  it("lists another member's public folder, with the same shared membership", async () => {
    const folder = await new SessionGroupModel(clientDB, memberA, ws).create({ name: 'Marketing' });
    const agentModel = new AgentModel(clientDB, memberA, ws);
    const agent = await agentModel.create({
      systemRole: '',
      title: 'Campaign Agent',
      visibility: 'public',
    } as any);
    await agentModel.updateSessionGroupId(agent.id, folder.id);

    // Member B never created the folder, never moved the agent into it.
    const forB = await new HomeRepository(clientDB, memberB, ws).getSidebarAgentList();
    const groupForB = forB.groups.find((g) => g.id === folder.id);

    expect(groupForB).toBeDefined();
    expect(groupForB!.name).toBe('Marketing');
    expect(groupForB!.items.map((i) => i.id)).toContain(agent.id);
    expect(forB.ungrouped.map((i) => i.id)).not.toContain(agent.id);
  });

  it("keeps another member's private folder out of the list", async () => {
    const folder = await new SessionGroupModel(clientDB, memberA, ws).create({
      name: 'A only',
      visibility: 'private',
    });

    const forA = await new HomeRepository(clientDB, memberA, ws).getSidebarAgentList();
    expect(forA.privateGroups.map((g) => g.id)).toContain(folder.id);

    const forB = await new HomeRepository(clientDB, memberB, ws).getSidebarAgentList();
    expect(forB.groups.map((g) => g.id)).not.toContain(folder.id);
    expect(forB.privateGroups.map((g) => g.id)).not.toContain(folder.id);
  });

  it('personal mode keeps reading the shared columns', async () => {
    const agentModel = new AgentModel(clientDB, memberA);
    const agent = await agentModel.create({
      systemRole: '',
      title: 'Personal Agent',
      visibility: 'private',
    } as any);
    await agentModel.update(agent.id, { pinned: true });

    const result = await new HomeRepository(clientDB, memberA).getSidebarAgentList();
    expect(result.pinned.map((a) => a.id)).toContain(agent.id);
  });
});
