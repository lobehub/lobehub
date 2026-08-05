// Regression: pinning a workspace-private agent must NOT move it into the
// shared `pinned` bucket (rendered under the public/Workspace section) — it
// should surface in `privatePinned` so the sidebar keeps it inside the
// Private section.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import * as Schema from '../../../schemas';
import { HomeRepository } from '../index';

const clientDB = await getTestDB();

const creator = 'u-creator';
const ws = 'ws-1';

beforeEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
  await clientDB.insert(Schema.users).values([{ id: creator }]);
  await clientDB.insert(Schema.workspaces).values({
    id: ws,
    name: 'WS',
    primaryOwnerId: creator,
    slug: 'ws-1',
  });
});

afterEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
});

describe('workspace private pinned bucket', () => {
  it('pinned private agent goes to privatePinned, not the public pinned bucket', async () => {
    const agentModel = new AgentModel(clientDB, creator, ws);

    const agent = await agentModel.create({
      systemRole: '',
      title: 'Private Agent',
      visibility: 'private',
    } as any);
    await agentModel.update(agent.id, { pinned: true });

    const result = await new HomeRepository(clientDB, creator, ws).getSidebarAgentList();

    expect(result.privatePinned.map((a) => a.id)).toContain(agent.id);
    expect(result.pinned.map((a) => a.id)).not.toContain(agent.id);
    expect(result.privateUngrouped.map((a) => a.id)).not.toContain(agent.id);
  });

  it('pinned public agent stays in the public pinned bucket', async () => {
    const agentModel = new AgentModel(clientDB, creator, ws);

    const agent = await agentModel.create({
      systemRole: '',
      title: 'Public Agent',
      visibility: 'public',
    } as any);
    await agentModel.update(agent.id, { pinned: true });

    const result = await new HomeRepository(clientDB, creator, ws).getSidebarAgentList();

    expect(result.pinned.map((a) => a.id)).toContain(agent.id);
    expect(result.privatePinned).toHaveLength(0);
  });

  it('personal mode keeps all pinned agents in the public pinned bucket', async () => {
    // No workspace scope: `visibility = private` rows are normalized to public,
    // so privatePinned must stay empty and the item lands in `pinned`.
    const agentModel = new AgentModel(clientDB, creator);

    const agent = await agentModel.create({
      systemRole: '',
      title: 'Personal Agent',
      visibility: 'private',
    } as any);
    await agentModel.update(agent.id, { pinned: true });

    const result = await new HomeRepository(clientDB, creator).getSidebarAgentList();

    expect(result.pinned.map((a) => a.id)).toContain(agent.id);
    expect(result.privatePinned).toEqual([]);
  });
});
