// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentHistoryJobs, agentHistoryJobTopics, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { drainAgentHistoryJob, processNextAgentHistoryJobTopic } from '../agentHistoryJob';
import { AgentTransferJobModel } from '../agentTransferJob';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'ahj-dispatch-user';
const topicId = 'ahj-dispatch-topic';

const createTransferJob = () =>
  AgentTransferJobModel.createJob(serverDB, {
    agentIds: [],
    sessionIds: [],
    source: { userId, workspaceId: null },
    target: { userId, workspaceId: null },
    topics: [{ activityAt: new Date(), id: topicId }],
  });

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, title: 'queued', userId });
});

afterEach(async () => {
  // Jobs carry no FK onto users; remove them explicitly before the user cascade.
  await serverDB.delete(agentHistoryJobs).where(eq(agentHistoryJobs.sourceUserId, userId));
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('agentHistoryJob dispatcher', () => {
  it('reports an unknown job as done without touching anything', async () => {
    expect(await processNextAgentHistoryJobTopic(serverDB, 'ahj-missing-job')).toEqual({
      done: true,
    });
  });

  it('routes a transfer job to the transfer drain', async () => {
    const jobId = await createTransferJob();

    expect(await processNextAgentHistoryJobTopic(serverDB, jobId)).toEqual({
      done: false,
      topicId,
    });
    expect(
      await serverDB.query.agentHistoryJobTopics.findMany({
        where: eq(agentHistoryJobTopics.jobId, jobId),
      }),
    ).toHaveLength(0);
  });

  it('drains a job of any type to completion', async () => {
    const jobId = await createTransferJob();

    await drainAgentHistoryJob(serverDB, jobId);

    const job = await serverDB.query.agentHistoryJobs.findFirst({
      where: eq(agentHistoryJobs.id, jobId),
    });
    expect(job).toMatchObject({ completedTopics: 1, status: 'completed', type: 'transfer' });
    expect(job?.completedAt).toBeInstanceOf(Date);
  });
});
