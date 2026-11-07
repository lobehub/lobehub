import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, agents, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-query-run-started-at-user';
const agentId = 'topic-query-run-started-at-agent';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel.query runStartedAt', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(agents).values({ id: agentId, userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  // Regression: the agent sidebar reads this list. Client-executed runs
  // (desktop CC, in-browser runtime) create no operation row, so without the
  // topic stamp their running rows showed a spinner and no elapsed clock.
  it('falls back to the topic stamp when the run left no operation row', async () => {
    await serverDB.insert(topics).values([
      {
        agentId,
        id: 't-local',
        metadata: { runStartedAt: '2026-01-05T00:00:00Z' },
        status: 'running',
        title: 'local',
        userId,
      },
      {
        agentId,
        id: 't-both',
        metadata: { runStartedAt: '2026-01-06T00:00:00Z' },
        status: 'running',
        title: 'both',
        userId,
      },
      {
        agentId,
        id: 't-done',
        metadata: { runStartedAt: '2026-01-04T00:00:00Z' },
        status: 'completed',
        title: 'done',
        userId,
      },
    ]);
    await serverDB.insert(agentOperations).values({
      id: 'op-both',
      startedAt: new Date('2026-01-07T00:00:00Z'),
      status: 'running',
      topicId: 't-both',
      userId,
    });

    const { items } = await topicModel.query({ agentId });
    const byId = Object.fromEntries(items.map((t) => [t.id, t]));

    expect(byId['t-local'].runStartedAt).toEqual(new Date('2026-01-05T00:00:00Z'));
    // The server's own record of the run beats the client-reported stamp.
    expect(byId['t-both'].runStartedAt).toEqual(new Date('2026-01-07T00:00:00Z'));
    // A stamp left behind by a finished run must not resurrect a timer.
    expect(byId['t-done'].runStartedAt).toBeNull();
  });
});
