// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { drizzle as drizzleProxy } from 'drizzle-orm/pg-proxy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { getTestDB } from '../../core/getTestDB';
import * as schema from '../../schemas';
import { agents as agentsTable, chatGroups, chatGroupsAgents, users } from '../../schemas';
import { ChatGroupModel } from '../chatGroup';

const userId = 'chat-group-coverage-user';
const otherUserId = 'chat-group-coverage-other';

const serverDB: LobeChatDatabase = await getTestDB();

const chatGroupModel = new ChatGroupModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Groups, agents and memberships cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('ChatGroupModel coverage', () => {
  it('skips a member row whose agent did not load', async () => {
    await serverDB.insert(chatGroups).values({ id: 'cg-cov-orphan', title: 'Orphan', userId });
    await serverDB.insert(agentsTable).values({ id: 'cg-cov-kept', title: 'Kept', userId });
    await serverDB
      .insert(chatGroupsAgents)
      .values({ agentId: 'cg-cov-kept', chatGroupId: 'cg-cov-orphan', userId });

    // A junction row can outlive its agent between reads; the relation then loads as null.
    const findMany = serverDB.query.chatGroupsAgents.findMany;
    vi.spyOn(serverDB.query.chatGroupsAgents, 'findMany').mockImplementationOnce(
      (config) =>
        findMany
          .call(serverDB.query.chatGroupsAgents, config)
          .then((rows) => [
            ...rows,
            { ...rows[0], agent: null, agentId: 'cg-cov-gone' },
          ]) as unknown as ReturnType<typeof findMany>,
    );

    const [group] = await chatGroupModel.queryWithMemberDetails();

    expect(group.id).toBe('cg-cov-orphan');
    expect(group.agents.map((agent: { id: string }) => agent.id)).toEqual(['cg-cov-kept']);
  });

  it('treats a legacy member without an order as order 0', async () => {
    await serverDB.insert(chatGroups).values({ id: 'cg-cov-null-order', title: 'Legacy', userId });
    await serverDB.insert(agentsTable).values([
      { id: 'cg-cov-legacy', title: 'Legacy', userId },
      { id: 'cg-cov-new', title: 'New', userId },
    ]);
    await serverDB.insert(chatGroupsAgents).values({
      agentId: 'cg-cov-legacy',
      chatGroupId: 'cg-cov-null-order',
      order: null,
      userId,
    });

    const result = await chatGroupModel.addAgentsToGroup('cg-cov-null-order', ['cg-cov-new']);

    expect(result.added.map((a) => a.order)).toEqual([1]);
  });

  it('short-circuits an empty group list in findOwnedMemberAgentIds without querying', async () => {
    const select = vi.spyOn(serverDB, 'select');

    expect(await chatGroupModel.findOwnedMemberAgentIds([])).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('counts 0 blocking groups when the aggregate comes back without a row', async () => {
    const proxyDB = drizzleProxy(async () => ({ rows: [] }), {
      schema,
    }) as unknown as LobeChatDatabase;
    const model = new ChatGroupModel(proxyDB, otherUserId, 'chat-group-coverage-ws');

    expect(await model.countGroupsBlockingAgentDemotion('any-agent', userId)).toBe(0);
  });
});
