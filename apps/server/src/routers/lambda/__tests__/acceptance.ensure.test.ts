// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { taskTopics, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';

import { acceptanceRouter } from '../acceptance';
import { createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

/**
 * `acceptance.ensure` folds a Task's run topic onto the Task only when report
 * ingest asks for it (the topic came from the ambient `LOBEHUB_TOPIC_ID`). An
 * explicitly requested subject — `lh acceptance create --subject topic:…` —
 * must stay exactly what the caller asked for.
 */
describe('acceptanceRouter.ensure subject folding', () => {
  let userId: string;
  let taskId: string;
  let topicId: string;

  beforeEach(async () => {
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
    const task = await new TaskModel(testDB, userId).create({ instruction: 'Drag to start' });
    taskId = task.id;
    topicId = `tpc_${randomUUID()}`;
    await testDB.insert(topics).values({ id: topicId, title: 'Run', userId });
    await testDB.insert(taskTopics).values({ seq: 1, taskId, topicId, userId });
  });

  const caller = () => acceptanceRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  it('keeps an explicitly requested task run topic as the subject', async () => {
    const acceptance = await caller().ensure({ subjectId: topicId, subjectType: 'topic' });

    expect(acceptance).toMatchObject({ subjectId: topicId, subjectType: 'topic' });
  });

  it('folds the ambient task run topic onto its Task for report ingest', async () => {
    const acceptance = await caller().ensure({
      foldTaskRunTopic: true,
      subjectId: topicId,
      subjectType: 'topic',
    });

    expect(acceptance).toMatchObject({ subjectId: taskId, subjectType: 'task' });
  });
});
