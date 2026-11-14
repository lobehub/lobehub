// The workspace sidebar lists a shared row by default only when the member
// created it or used it recently. The repository supplies the per-member
// `lastUsedAt` signal.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import * as Schema from '../../../schemas';
import { HomeRepository, SIDEBAR_RECENT_USE_DAYS } from '../index';

const clientDB = await getTestDB();

const memberA = 'u-recent-a';
const memberB = 'u-recent-b';
const ws = 'ws-recent-use';

const DAY = 24 * 60 * 60 * 1000;

const createPublicAgent = async (title: string) =>
  new AgentModel(clientDB, memberA, ws).create({
    systemRole: '',
    title,
    visibility: 'public',
  } as any);

const addTopic = async (userId: string, agentId: string, updatedAt: Date, trigger?: string) =>
  clientDB.insert(Schema.topics).values({
    agentId,
    title: 'topic',
    trigger,
    updatedAt,
    userId,
    workspaceId: ws,
  });

const findItem = (list: Awaited<ReturnType<HomeRepository['getSidebarAgentList']>>, id: string) =>
  [...list.ungrouped, ...list.pinned, ...list.groups.flatMap((g) => g.items)].find(
    (i) => i.id === id,
  );

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

describe('HomeRepository workspace recent use', () => {
  it('reports the member’s own recent use, not a teammate’s', async () => {
    const agent = await createPublicAgent('Shared');
    const usedAt = new Date(Date.now() - 2 * DAY);
    await addTopic(memberB, agent.id, usedAt);

    const forB = await new HomeRepository(clientDB, memberB, ws).getSidebarAgentList();
    const forA = await new HomeRepository(clientDB, memberA, ws).getSidebarAgentList();

    expect(new Date(findItem(forB, agent.id)!.lastUsedAt!).getTime()).toBe(usedAt.getTime());
    expect(findItem(forA, agent.id)!.lastUsedAt).toBeUndefined();
  });

  it('ignores use older than the recent window', async () => {
    const agent = await createPublicAgent('Stale');
    await addTopic(memberB, agent.id, new Date(Date.now() - (SIDEBAR_RECENT_USE_DAYS + 1) * DAY));

    const forB = await new HomeRepository(clientDB, memberB, ws).getSidebarAgentList();

    expect(findItem(forB, agent.id)!.lastUsedAt).toBeUndefined();
  });

  it('does not count scheduled or eval topics as use', async () => {
    const agent = await createPublicAgent('Cron only');
    await addTopic(memberB, agent.id, new Date(Date.now() - DAY), 'cron');
    await addTopic(memberB, agent.id, new Date(Date.now() - DAY), 'eval');

    const forB = await new HomeRepository(clientDB, memberB, ws).getSidebarAgentList();

    expect(findItem(forB, agent.id)!.lastUsedAt).toBeUndefined();
  });

  it('reports the latest of several topics', async () => {
    const agent = await createPublicAgent('Busy');
    const latest = new Date(Date.now() - DAY);
    await addTopic(memberB, agent.id, new Date(Date.now() - 5 * DAY));
    await addTopic(memberB, agent.id, latest);

    const forB = await new HomeRepository(clientDB, memberB, ws).getSidebarAgentList();

    expect(new Date(findItem(forB, agent.id)!.lastUsedAt!).getTime()).toBe(latest.getTime());
  });

  it('reports no recent use in personal mode', async () => {
    const personalAgent = await new AgentModel(clientDB, memberA).create({
      systemRole: '',
      title: 'Personal',
    } as any);
    await clientDB.insert(Schema.topics).values({
      agentId: personalAgent.id,
      title: 'topic',
      userId: memberA,
    });

    const view = await new HomeRepository(clientDB, memberA).getSidebarAgentList();

    expect(findItem(view, personalAgent.id)!.lastUsedAt).toBeUndefined();
  });
});
