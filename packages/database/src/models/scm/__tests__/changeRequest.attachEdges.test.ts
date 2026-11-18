// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { scmChangeRequests, topics, users, works, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ScmChangeRequestModel } from '../changeRequest';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'scm-attach-user';
const workspaceId = 'scm-attach-ws';
const missingId = '00000000-0000-4000-8000-000000000002';

const row = (number: number, overrides: Record<string, unknown> = {}) =>
  ScmChangeRequestModel.upsert(serverDB, {
    number,
    provider: 'github',
    repoFullName: 'LobeHub/LobeHub',
    state: 'open',
    url: `https://github.com/LobeHub/LobeHub/pull/${number}`,
    userId,
    ...overrides,
  });

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Attach', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(scmChangeRequests);
  await serverDB.delete(works).where(eq(works.id, 'work-ws'));
  await serverDB.delete(topics).where(eq(topics.id, 'topic-ws'));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('ScmChangeRequestModel attach edges', () => {
  it('answers null for a row that does not exist', async () => {
    expect(await ScmChangeRequestModel.findById(serverDB, missingId)).toBeNull();
  });

  it('re-reads the row when there is nothing to attach', async () => {
    const created = await row(501);

    const attached = await ScmChangeRequestModel.attachLinks(serverDB, created!.id, {});

    expect(attached?.id).toBe(created!.id);
    expect(attached?.topicId).toBeNull();
  });

  it('fills a workspace row through the workspace scope', async () => {
    await serverDB.insert(topics).values({ id: 'topic-ws', userId });
    await serverDB.insert(works).values({
      id: 'work-ws',
      resourceId: 'lobehub/lobehub#502',
      resourceType: 'github_pull_request',
      toolIdentifier: 'github',
      toolName: 'create_pull_request',
      type: 'external',
      userId,
      visibility: 'private',
    });
    const created = await row(502, { workspaceId });

    await ScmChangeRequestModel.attachPullRequestWork(serverDB, {
      number: 502,
      repoFullName: 'lobehub/lobehub',
      scope: { userId, workspaceId },
      topicId: 'topic-ws',
      workId: 'work-ws',
    });

    const [after] = await serverDB
      .select()
      .from(scmChangeRequests)
      .where(eq(scmChangeRequests.id, created!.id));
    expect(after.topicId).toBe('topic-ws');
    expect(after.workId).toBe('work-ws');
  });
});
