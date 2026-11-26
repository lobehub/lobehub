import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-children-user';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

const childOf = (topicId: string, extra: Record<string, unknown> = {}) => ({
  openedBy: { at: '2026-11-18T00:00:00.000Z', topicId, ...extra },
});

describe('TopicModel - child topics (metadata.openedBy)', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(agents).values([
      { id: 'agent-mine', userId },
      { id: 'agent-hidden', userId },
    ]);
    await serverDB.insert(topics).values([
      { agentId: 'agent-mine', id: 'parent', userId },
      // The newest children run the agent the caller may not see.
      ...[1, 2, 3].map((n) => ({
        agentId: 'agent-hidden',
        id: `hidden-${n}`,
        metadata: childOf('parent'),
        updatedAt: new Date(`2026-11-18T0${n + 3}:00:00.000Z`),
        userId,
      })),
      ...[1, 2].map((n) => ({
        agentId: 'agent-mine',
        id: `mine-${n}`,
        metadata: childOf('parent'),
        updatedAt: new Date(`2026-11-18T0${n}:00:00.000Z`),
        userId,
      })),
      {
        agentId: 'agent-mine',
        id: 'unlinked',
        metadata: childOf('parent', { detachedAt: '2026-11-18T05:00:00.000Z' }),
        userId,
      },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it("names the agents a topic's children run, without unlinked ones", async () => {
    expect((await topicModel.listChildTopicAgentIds('parent')).sort()).toEqual([
      'agent-hidden',
      'agent-mine',
    ]);
  });

  it('pages and counts only the children of the allowed agents', async () => {
    const firstPage = await topicModel.query({
      openedByAgentIds: ['agent-mine'],
      openedByTopicId: 'parent',
      pageSize: 1,
    });

    // The hidden agent's newer children neither fill the page nor the total.
    expect(firstPage.items.map((item: any) => item.id)).toEqual(['mine-2']);
    expect(firstPage.total).toBe(2);

    const secondPage = await topicModel.query({
      current: 1,
      openedByAgentIds: ['agent-mine'],
      openedByTopicId: 'parent',
      pageSize: 1,
    });
    expect(secondPage.items.map((item: any) => item.id)).toEqual(['mine-1']);
  });

  it('lists every child when no agent restriction is given', async () => {
    const all = await topicModel.query({ openedByTopicId: 'parent' });

    expect(all.total).toBe(5);
  });
});
