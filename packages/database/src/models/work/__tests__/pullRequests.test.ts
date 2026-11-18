// @vitest-environment node
import type { RegisterExternalWorkParams } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { topics } from '../../../schemas';
import { WorkModel } from '..';
import {
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  threadId,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

const pr = (
  identifier: string,
  toolCallId: string,
  overrides: Partial<RegisterExternalWorkParams> = {},
): RegisterExternalWorkParams => ({
  changeType: 'created',
  identifier,
  patchFields: ['identifier', 'title', 'status', 'url'],
  resourceId: identifier,
  resourceType: 'github_pull_request',
  status: 'open',
  title: `PR ${identifier}`,
  toolCallId,
  toolIdentifier: 'claude-code',
  toolName: 'Bash',
  topicId,
  url: `https://github.com/${identifier.replace('#', '/pull/')}`,
  ...overrides,
});

describe('WorkModel.listTopicPullRequests', () => {
  it('lists every pull request linked to the topic once, latest link first', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerExternal(
      pr('lobehub/lobehub#1', 'call-1', {
        metadata: { baseBranch: 'canary', headBranch: 'feat/a' },
      }),
    );
    await model.registerExternal(pr('lobehub/lobehub#2', 'call-2', { threadId }));
    // A later command on #1 (merge) links it again — still one row, now newest.
    await model.registerExternal(
      pr('lobehub/lobehub#1', 'call-3', {
        changeType: 'updated',
        patchFields: ['identifier', 'status'],
        status: 'merged',
      }),
    );

    const items = await model.listTopicPullRequests(topicId);

    expect(items.map((item) => item.identifier)).toEqual([
      'lobehub/lobehub#1',
      'lobehub/lobehub#2',
    ]);
    expect(items[0]).toMatchObject({
      baseBranch: 'canary',
      headBranch: 'feat/a',
      number: 1,
      repoFullName: 'lobehub/lobehub',
      status: 'merged',
      title: 'PR lobehub/lobehub#1',
      url: 'https://github.com/lobehub/lobehub/pull/1',
    });
    expect(items[0].linkedAt).toBeInstanceOf(Date);
  });

  it('ignores issues, other topics and other users', async () => {
    const otherTopicId = 'work-test-other-topic';
    await serverDB.insert(topics).values({ id: otherTopicId, userId });
    const model = new WorkModel(serverDB, userId);
    await model.registerExternal(
      pr('lobehub/lobehub#3', 'call-issue', { resourceType: 'github_issue' }),
    );
    await model.registerExternal(pr('lobehub/lobehub#4', 'call-other', { topicId: otherTopicId }));
    await new WorkModel(serverDB, userId2).registerExternal(pr('lobehub/lobehub#5', 'call-user2'));

    expect(await model.listTopicPullRequests(topicId)).toEqual([]);
    expect((await model.listTopicPullRequests(otherTopicId)).map((i) => i.number)).toEqual([4]);
  });

  it('includes a pull request first registered in another topic once this topic touches it', async () => {
    const otherTopicId = 'work-test-origin-topic';
    await serverDB.insert(topics).values({ id: otherTopicId, userId });
    const model = new WorkModel(serverDB, userId);
    await model.registerExternal(pr('lobehub/lobehub#6', 'call-origin', { topicId: otherTopicId }));
    await model.registerExternal(
      pr('lobehub/lobehub#6', 'call-here', { changeType: 'updated', patchFields: ['identifier'] }),
    );

    expect((await model.listTopicPullRequests(topicId)).map((i) => i.number)).toEqual([6]);
  });

  it('skips a pull request Work whose identity is not owner/repo#number', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerExternal(pr('lobehub/lobehub#7', 'call-ok'));
    await model.registerExternal({
      ...pr('lobehub/lobehub#7', 'call-bad'),
      identifier: 'not-a-pr',
      resourceId: 'not-a-pr',
    });

    expect((await model.listTopicPullRequests(topicId)).map((i) => i.identifier)).toEqual([
      'lobehub/lobehub#7',
    ]);
  });

  it('reports how the topic linked each PR', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerExternal(pr('lobehub/lobehub#10', 'call-create'));
    await model.registerExternal(
      pr('lobehub/lobehub#11', 'call-merge', {
        changeType: 'updated',
        patchFields: ['identifier'],
      }),
    );
    await model.registerExternal(
      pr('lobehub/lobehub#12', 'call-push', {
        changeType: 'updated',
        metadata: { headBranch: 'feat/p', pullRequestLink: 'push' },
        patchFields: ['identifier'],
      }),
    );

    const sources = Object.fromEntries(
      (await model.listTopicPullRequests(topicId)).map((i) => [i.number, i.source]),
    );
    expect(sources).toEqual({ 10: 'created', 11: 'command', 12: 'push' });
  });

  it('reports a PR first linked by a push as command once a command names it', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerExternal(
      pr('lobehub/lobehub#20', 'call-push', {
        changeType: 'updated',
        metadata: { headBranch: 'feat/p', pullRequestLink: 'push' },
        patchFields: ['identifier'],
      }),
    );
    // gh pr edit 20: the normalizer stamps its own marker over the merged metadata.
    await model.registerExternal(
      pr('lobehub/lobehub#20', 'call-edit', {
        changeType: 'updated',
        metadata: { pullRequestLink: 'command' },
        patchFields: ['identifier', 'title'],
      }),
    );

    expect((await model.listTopicPullRequests(topicId))[0]).toMatchObject({
      headBranch: 'feat/p',
      number: 20,
      source: 'command',
    });
  });
});
