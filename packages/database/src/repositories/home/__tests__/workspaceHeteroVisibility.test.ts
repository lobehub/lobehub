// Regression for LOBE-11758: a workspace heterogeneous agent flipped back to
// `private` must stay visible to its creator (Private bucket) and invisible
// to other members across the whole sidebar payload.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import * as Schema from '../../../schemas';
import { HomeRepository } from '../index';

const clientDB = await getTestDB();

const creator = 'u-creator';
const member = 'u-member';
const ws = 'ws-1';

beforeEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
  await clientDB.insert(Schema.users).values([{ id: creator }, { id: member }]);
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

describe('workspace hetero agent visibility flip (LOBE-11758)', () => {
  it('hetero agent stays visible to creator after public -> private', async () => {
    const agentModel = new AgentModel(clientDB, creator, ws);

    // mirrors useCreateHeteroAgent -> lambda createAgent (public default)
    const agent = await agentModel.create({
      agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } } as any,
      provider: 'claude-code',
      systemRole: '',
      title: 'CC Agent',
    });

    // sanity: visible in workspace sidebar (public)
    const before = await new HomeRepository(clientDB, creator, ws).getSidebarAgentList();
    expect(before.ungrouped.map((a) => a.id)).toContain(agent.id);

    // flip back to private (router path: getAgentVisibilityMeta -> setVisibility)
    const updated = await agentModel.setVisibility(agent.id, 'private');
    expect(updated).not.toBeNull();

    // creator should still see it in the Private bucket
    const after = await new HomeRepository(clientDB, creator, ws).getSidebarAgentList();
    const everywhere = [
      ...after.pinned,
      ...after.ungrouped,
      ...after.privateUngrouped,
      ...after.groups.flatMap((g) => g.items),
      ...after.privateGroups.flatMap((g) => g.items),
    ];
    expect(after.privateUngrouped.map((a) => a.id)).toContain(agent.id);
    expect(everywhere.map((a) => a.id)).toContain(agent.id);

    // member should NOT see it
    const memberView = await new HomeRepository(clientDB, member, ws).getSidebarAgentList();
    const memberAll = [
      ...memberView.pinned,
      ...memberView.ungrouped,
      ...memberView.privateUngrouped,
      ...memberView.groups.flatMap((g) => g.items),
      ...memberView.privateGroups.flatMap((g) => g.items),
    ];
    expect(memberAll.map((a) => a.id)).not.toContain(agent.id);
  });
});
