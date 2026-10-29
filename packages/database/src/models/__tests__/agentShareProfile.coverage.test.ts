// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, topics, users, works, workVersions } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareProfileModel } from '../agentShareProfile';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'aspcov-user';
const agentId = 'aspcov-agent';
const topicId = 'aspcov-topic';
const workId = 'aspcov-work';

const cleanup = async () => {
  // agents / topics / works / work_versions all cascade from the owning user.
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('AgentShareProfileModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(agents).values({ id: agentId, slug: 'aspcov-agent', userId });
    await serverDB.insert(topics).values({ agentId, id: topicId, userId });
    await serverDB.insert(works).values({
      description: 'An uncosted file',
      id: workId,
      originAgentId: agentId,
      originTopicId: topicId,
      resourceType: 'file',
      title: 'aspcov file',
      toolIdentifier: 'files',
      toolName: 'createFile',
      type: 'file',
      url: null,
      userId,
      visibility: 'private',
    });
    const [version] = await serverDB
      .insert(workVersions)
      .values({
        agentId,
        changeType: 'created',
        cumulativeCost: null,
        rootOperationId: null,
        toolIdentifier: 'files',
        toolName: 'createFile',
        topicId,
        version: 1,
        workId,
      })
      .returning();
    await serverDB.update(works).set({ currentVersionId: version.id }).where(eq(works.id, workId));
  });

  afterEach(async () => {
    await cleanup();
  });

  it('listEligibleWorks reports a null cost and URL for a Work with neither', async () => {
    const model = new AgentShareProfileModel(serverDB, userId);

    const { hasMore, items } = await model.listEligibleWorks(agentId);

    expect(hasMore).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: workId, totalCost: null, type: 'file', url: null });
  });

  it('getStats falls back to zero Works when the aggregate returns no row', async () => {
    // An aggregate without GROUP BY always yields one row on Postgres; the driver
    // seam drops it to exercise the empty-result fallback of the Work stats read.
    const db = createProxyTestDB(serverDB, (query, result) =>
      query.includes('"share_eligible_works"') && query.includes('count(') ? [] : result.rows,
    );
    const model = new AgentShareProfileModel(db, userId);

    await expect(model.getStats(agentId)).resolves.toEqual({
      averageOperationDurationSeconds: null,
      averageWorkCost: null,
      lastDeliveredAt: null,
      workCount: 0,
    });
  });
});
