// @vitest-environment node
import { agentShareWorkAccessScope, type ScmUpsertChangeRequestParams } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scmChangeRequests, topics } from '../../../schemas';
import { ScmChangeRequestModel } from '../../scm';
import { WorkModel } from '..';
import {
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

const pullRequestRow = (overrides: Partial<ScmUpsertChangeRequestParams> = {}) =>
  ScmChangeRequestModel.upsert(serverDB, {
    number: 7,
    provider: 'github',
    repoFullName: 'lobehub/lobehub',
    state: 'open',
    url: 'https://github.com/lobehub/lobehub/pull/7',
    userId,
    ...overrides,
  });

const registerPullRequest = (model: WorkModel, toolCallId = 'call-pr') =>
  model.registerExternal({
    changeType: 'created',
    identifier: 'lobehub/lobehub#7',
    patchFields: ['identifier'],
    resourceId: 'lobehub/lobehub#7',
    resourceType: 'github_pull_request',
    toolCallId,
    toolIdentifier: 'github',
    toolName: 'create_pull_request',
    topicId,
  });

const rowOf = async (id: string) => {
  const [row] = await serverDB.select().from(scmChangeRequests).where(eq(scmChangeRequests.id, id));
  return row;
};

describe('WorkModel · pull-request work backfills the provider row', () => {
  it('fills topicId and workId on a linkless row in the same scope', async () => {
    const row = await pullRequestRow();
    expect(row.topicId).toBeNull();
    expect(row.workId).toBeNull();

    const work = await registerPullRequest(new WorkModel(serverDB, userId));

    const after = await rowOf(row.id);
    expect(after?.topicId).toBe(topicId);
    expect(after?.workId).toBe(work?.id);
  });

  it('leaves a row owned by another scope untouched', async () => {
    const row = await pullRequestRow({ userId: userId2 });

    await registerPullRequest(new WorkModel(serverDB, userId));

    const after = await rowOf(row.id);
    expect(after?.topicId).toBeNull();
    expect(after?.workId).toBeNull();
  });

  it('never replaces a link the row already has', async () => {
    await serverDB.insert(topics).values({ id: 'existing-topic', userId });
    const row = await pullRequestRow({ links: { topicId: 'existing-topic' } });

    await registerPullRequest(new WorkModel(serverDB, userId));

    const after = await rowOf(row.id);
    expect(after?.topicId).toBe('existing-topic');
    // workId was still empty, so that one does fill.
    expect(after?.workId).not.toBeNull();
  });

  it('ignores share-visitor registrations', async () => {
    const row = await pullRequestRow();
    const visitor = new WorkModel(
      serverDB,
      userId,
      undefined,
      agentShareWorkAccessScope({
        shareId: 'share-1',
        topicId: 'visitor-topic',
        visitorUserId: userId,
      }),
    );

    await registerPullRequest(visitor);

    const after = await rowOf(row.id);
    expect(after?.topicId).toBeNull();
    expect(after?.workId).toBeNull();
  });
});
