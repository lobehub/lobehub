// Regression: pinning is FULLY per-member in workspace mode. Only the
// caller's `sidebarPinnedOverrides` entries pin items — the shared
// `agents.pinned` / `chat_groups.pinned` columns are ignored entirely (no
// fallback), so neither another member's legacy pin nor a transferred-in
// agent's personal-mode pin can surface in anyone's sidebar.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { WorkspaceUserSettingsModel } from '../../../models/workspaceUserSettings';
import * as Schema from '../../../schemas';
import { HomeRepository } from '../index';

const clientDB = await getTestDB();

const memberA = 'u-member-a';
const memberB = 'u-member-b';
const ws = 'ws-pin-override';

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

describe('workspace per-member pins (no shared-column fallback)', () => {
  it("member's pin floats the item into their own pinned bucket only", async () => {
    const agentModel = new AgentModel(clientDB, memberA, ws);
    const agent = await agentModel.create({
      systemRole: '',
      title: 'Shared Agent',
      visibility: 'public',
    } as any);

    await new WorkspaceUserSettingsModel(clientDB, memberA, ws).updatePreference({
      sidebarPinnedOverrides: { [agent.id]: true },
    });

    const forA = await new HomeRepository(clientDB, memberA, ws).getSidebarAgentList();
    expect(forA.pinned.map((a) => a.id)).toContain(agent.id);

    // Member B never pinned it — unpinned for them, regardless of A's action.
    const forB = await new HomeRepository(clientDB, memberB, ws).getSidebarAgentList();
    expect(forB.pinned.map((a) => a.id)).not.toContain(agent.id);
    expect(forB.ungrouped.map((a) => a.id)).toContain(agent.id);
  });

  it('ignores the shared pinned column for every member (legacy / transferred-in pins)', async () => {
    const agentModel = new AgentModel(clientDB, memberA, ws);
    const agent = await agentModel.create({
      systemRole: '',
      title: 'Legacy Pinned Agent',
      visibility: 'public',
    } as any);
    // Shared-column pin: pre-per-member legacy state, or a personal-mode pin
    // carried along by transferAgents (ownership update keeps `pinned`).
    await agentModel.update(agent.id, { pinned: true });

    for (const member of [memberA, memberB]) {
      const view = await new HomeRepository(clientDB, member, ws).getSidebarAgentList();
      expect(view.pinned.map((a) => a.id)).not.toContain(agent.id);
      expect(view.ungrouped.map((a) => a.id)).toContain(agent.id);
    }
  });

  it("member's explicit unpin entry keeps the item unpinned for them", async () => {
    const agentModel = new AgentModel(clientDB, memberA, ws);
    const agent = await agentModel.create({
      systemRole: '',
      title: 'Toggled Agent',
      visibility: 'public',
    } as any);

    const settings = new WorkspaceUserSettingsModel(clientDB, memberA, ws);
    await settings.updatePreference({ sidebarPinnedOverrides: { [agent.id]: true } });
    await settings.updatePreference({ sidebarPinnedOverrides: { [agent.id]: false } });

    const forA = await new HomeRepository(clientDB, memberA, ws).getSidebarAgentList();
    expect(forA.pinned.map((a) => a.id)).not.toContain(agent.id);
    expect(forA.ungrouped.map((a) => a.id)).toContain(agent.id);
  });

  it('personal mode keeps reading the shared column', async () => {
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
