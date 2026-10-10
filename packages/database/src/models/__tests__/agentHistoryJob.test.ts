// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentHistoryJobTopics, agentHistoryJobs, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { drainAgentHistoryJob, processNextAgentHistoryJobTopic } from '../agentHistoryJob';

const serverDB: LobeChatDatabase = await getTestDB();

const sourceUserId = 'ahj-source-user';
const targetUserId = 'ahj-target-user';

const createJob = async (
  type: 'copy' | 'transfer',
  status: 'completed' | 'pending' = 'pending',
) => {
  const [job] = await serverDB
    .insert(agentHistoryJobs)
    .values({
      agentIds: [],
      groupIds: [],
      sessionIds: [],
      sourceUserId,
      status,
      targetUserId,
      totalTopics: 0,
      type,
    })
    .returning();

  return job;
};

const readJob = async (id: string) => {
  const [job] = await serverDB.select().from(agentHistoryJobs).where(eq(agentHistoryJobs.id, id));
  return job;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: sourceUserId }, { id: targetUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('agentHistoryJob · type dispatch', () => {
  it('reports done for a job that no longer exists', async () => {
    await expect(processNextAgentHistoryJobTopic(serverDB, 'missing-job-id')).resolves.toEqual({
      done: true,
    });
  });

  it('routes a transfer job to the transfer model and settles an empty queue', async () => {
    const job = await createJob('transfer');

    await expect(processNextAgentHistoryJobTopic(serverDB, job.id)).resolves.toEqual({
      done: true,
    });

    const settled = await readJob(job.id);
    expect(settled.status).toBe('completed');
    expect(settled.completedAt).not.toBeNull();
  });

  it('routes a copy job to the copy model and settles an empty queue', async () => {
    const job = await createJob('copy');

    await expect(processNextAgentHistoryJobTopic(serverDB, job.id)).resolves.toEqual({
      done: true,
    });

    expect((await readJob(job.id)).status).toBe('completed');
  });

  it('leaves an already completed job untouched', async () => {
    const job = await createJob('transfer', 'completed');

    await expect(processNextAgentHistoryJobTopic(serverDB, job.id)).resolves.toEqual({
      done: true,
    });

    const unchanged = await readJob(job.id);
    expect(unchanged.status).toBe('completed');
    expect(unchanged.completedAt).toBeNull();
  });

  it('drains a job unit by unit until the queue is empty', async () => {
    await serverDB.insert(topics).values({ id: 'ahj-topic-1', userId: sourceUserId });
    const job = await createJob('copy');
    // A queue row without copy coordinates is dropped rather than retried, so
    // the drain has to come back for a second unit before it can settle.
    await serverDB
      .insert(agentHistoryJobTopics)
      .values({ activityAt: new Date(), jobId: job.id, topicId: 'ahj-topic-1' });

    await expect(drainAgentHistoryJob(serverDB, job.id)).resolves.toBeUndefined();

    const settled = await readJob(job.id);
    expect(settled.status).toBe('completed');

    const queued = await serverDB
      .select()
      .from(agentHistoryJobTopics)
      .where(eq(agentHistoryJobTopics.jobId, job.id));
    expect(queued).toHaveLength(0);
  });
});
