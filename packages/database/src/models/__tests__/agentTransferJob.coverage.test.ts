// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentHistoryJobs, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AgentTransferJobModel,
  remapMessageAgentIdsForTopics,
  remapResidualMessageAgentIds,
  rewriteResidualMessageScope,
} from '../agentTransferJob';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'atjcov-user';
const topicIds = ['atjcov-t1', 'atjcov-t2'];
const target = { userId, workspaceId: null };

const createdJobIds: string[] = [];

const cleanup = async () => {
  // Jobs carry no FK onto users, so remove the ones this file created explicitly.
  if (createdJobIds.length > 0) {
    await serverDB.delete(agentHistoryJobs).where(inArray(agentHistoryJobs.id, createdJobIds));
    createdJobIds.length = 0;
  }
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('AgentTransferJobModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(topics).values(topicIds.map((id) => ({ id, title: id, userId })));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  describe('message rewrite helpers', () => {
    it('rewriteResidualMessageScope issues no statement when the linkage is empty', async () => {
      const executor = { execute: vi.fn() };

      await rewriteResidualMessageScope(
        executor as unknown as LobeChatDatabase,
        { agentIds: [], groupIds: [], sessionIds: [] },
        target,
      );

      expect(executor.execute).not.toHaveBeenCalled();
    });

    it('remapMessageAgentIdsForTopics issues no statement without remap pairs', async () => {
      const executor = { execute: vi.fn() };

      await remapMessageAgentIdsForTopics(
        executor as unknown as LobeChatDatabase,
        ['atjcov-t1'],
        [],
      );

      expect(executor.execute).not.toHaveBeenCalled();
    });

    it('remapResidualMessageAgentIds issues no statement without group ids', async () => {
      const executor = { execute: vi.fn() };

      await remapResidualMessageAgentIds(
        executor as unknown as LobeChatDatabase,
        [],
        [{ newAgentId: 'new', sourceAgentId: 'source' }],
      );

      expect(executor.execute).not.toHaveBeenCalled();
    });
  });

  describe('guards with empty id lists', () => {
    it('hasPendingRemapForSourceAgents answers false without querying', async () => {
      const selectSpy = vi.spyOn(serverDB, 'select');

      await expect(
        AgentTransferJobModel.hasPendingRemapForSourceAgents(serverDB, []),
      ).resolves.toBe(false);
      expect(selectSpy).not.toHaveBeenCalled();
    });

    it('hasPendingJobForGroups answers false without querying', async () => {
      const selectSpy = vi.spyOn(serverDB, 'select');

      await expect(AgentTransferJobModel.hasPendingJobForGroups(serverDB, [])).resolves.toBe(false);
      expect(selectSpy).not.toHaveBeenCalled();
    });
  });

  describe('getPendingTopicIds', () => {
    const createJob = async () => {
      const jobId = await AgentTransferJobModel.createJob(serverDB, {
        agentIds: [],
        sessionIds: [],
        source: target,
        target,
        topics: topicIds.map((id, index) => ({ activityAt: new Date(2026, 0, index + 1), id })),
      });
      createdJobIds.push(jobId);
      return jobId;
    };

    it('returns the whole queue when no candidates are given', async () => {
      const jobId = await createJob();

      const pending = await AgentTransferJobModel.getPendingTopicIds(serverDB, jobId);

      expect(pending.sort()).toEqual([...topicIds].sort());
    });

    it('returns only the queued topics among the given candidates', async () => {
      const jobId = await createJob();

      const pending = await AgentTransferJobModel.getPendingTopicIds(serverDB, jobId, [
        'atjcov-t2',
        'atjcov-not-queued',
      ]);

      expect(pending).toEqual(['atjcov-t2']);
    });

    it('returns an empty list for an empty candidate list without querying', async () => {
      const jobId = await createJob();
      const selectSpy = vi.spyOn(serverDB, 'select');

      await expect(AgentTransferJobModel.getPendingTopicIds(serverDB, jobId, [])).resolves.toEqual(
        [],
      );
      expect(selectSpy).not.toHaveBeenCalled();
    });
  });
});
