// @vitest-environment node
import type { RegisterExternalWorkParams } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { topics, works, workspaces, workVersions } from '../../../schemas';
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

describe('WorkModel.listTopicsByPullRequest', () => {
  const identifier = 'lobeHub/lobehub#42';
  const link = (source: 'branch' | 'manual') => ({
    identifier,
    linkedAt: '2026-11-01T00:00:00Z',
    source,
    url: 'https://github.com/lobeHub/lobehub/pull/42',
    vouched: true,
  });

  it('returns Work, manual and branch associations once and respects dismissal', async () => {
    await serverDB.insert(topics).values([
      { id: 'work-other', userId },
      { id: 'manual', metadata: { pullRequests: { links: [link('manual')] } }, userId },
      { id: 'branch', metadata: { pullRequests: { links: [link('branch')] } }, userId },
      {
        id: 'dismissed',
        metadata: {
          pullRequests: { dismissed: [identifier.toUpperCase()], links: [link('manual')] },
        },
        userId,
      },
      { id: 'same-number', userId },
    ]);
    await serverDB
      .update(topics)
      .set({ metadata: { pullRequests: { links: [link('manual')] } } })
      .where(eq(topics.id, topicId));
    const model = new WorkModel(serverDB, userId);
    await model.registerExternal(pr(identifier, 'first'));
    await model.registerExternal(pr(identifier, 'again', { changeType: 'updated' }));
    await model.registerExternal(pr(identifier, 'other', { topicId: 'work-other' }));
    await model.registerExternal(pr(identifier, 'dismissed', { topicId: 'dismissed' }));
    await model.registerExternal(pr('another/repo#42', 'another', { topicId: 'same-number' }));

    const matches = await model.listTopicsByPullRequest(identifier.toUpperCase());
    expect(matches.map((topic) => topic.topicId).sort()).toEqual(
      ['branch', 'manual', 'work-other', topicId].sort(),
    );
    expect(await model.listTopicsByPullRequest('lobehub/lobehub#43')).toEqual([]);
  });

  it('keeps personal, workspace, trashed and Agent Share topics fenced', async () => {
    const workspaceId = 'work-pr-lookup-workspace';
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Test',
      primaryOwnerId: userId,
      slug: 'pr-lookup',
    });
    try {
      const metadata = { pullRequests: { links: [link('manual')] } };
      await serverDB.insert(topics).values([
        { id: 'mine', metadata, userId },
        { id: 'someone-elses', metadata, userId: userId2 },
        { id: 'team', metadata, userId, workspaceId },
        { id: 'team-work-only', userId, workspaceId },
        { id: 'trashed', isDeleted: true, metadata, userId },
        { id: 'visitor', metadata, senderId: 'visitor-id', userId },
      ]);
      await new WorkModel(serverDB, userId, workspaceId).registerExternal(
        pr(identifier, 'team-work', { topicId: 'team-work-only' }),
      );

      const personal = await new WorkModel(serverDB, userId).listTopicsByPullRequest(identifier);
      expect(personal.map((topic) => topic.topicId)).toEqual(['mine']);
      const team = await new WorkModel(serverDB, userId2, workspaceId).listTopicsByPullRequest(
        identifier,
      );
      expect(team.map((topic) => topic.topicId)).toEqual(['team']);
    } finally {
      await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
  });

  it('matches the sidebar cap on historical Work links per topic', async () => {
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-02-01T00:00:00Z');
    const resourceIds = [identifier, ...Array.from({ length: 50 }, (_, i) => `a/b#${i + 1}`)];
    const rows = await serverDB
      .insert(works)
      .values(
        resourceIds.map((resourceId) => ({
          resourceId,
          resourceType: 'github_pull_request' as const,
          toolIdentifier: 'github',
          toolName: 'update_pull_request',
          type: 'external' as const,
          userId,
          visibility: 'private' as const,
        })),
      )
      .returning({ id: works.id, resourceId: works.resourceId });
    await serverDB.insert(workVersions).values(
      rows.map((row) => ({
        changeType: 'updated' as const,
        createdAt: row.resourceId === identifier ? older : newer,
        toolIdentifier: 'github',
        toolName: 'update_pull_request',
        topicId,
        version: 1,
        workId: row.id,
      })),
    );

    const model = new WorkModel(serverDB, userId);
    expect(
      (await model.listTopicPullRequests(topicId)).map((item) => item.identifier),
    ).not.toContain(identifier);
    expect(await model.listTopicsByPullRequest(identifier)).toEqual([]);

    await serverDB
      .update(topics)
      .set({ metadata: { pullRequests: { links: [link('manual')] } } })
      .where(eq(topics.id, topicId));
    expect((await model.listTopicsByPullRequest(identifier)).map((topic) => topic.topicId)).toEqual(
      [topicId],
    );
  });
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

describe('WorkModel.listTopicsPullRequests', () => {
  it('lists each topic its own pull requests in one read, latest link first', async () => {
    const secondTopicId = 'work-test-second-topic';
    const emptyTopicId = 'work-test-empty-topic';
    await serverDB.insert(topics).values([
      { id: secondTopicId, userId },
      { id: emptyTopicId, userId },
    ]);
    const model = new WorkModel(serverDB, userId);
    await model.registerExternal(pr('lobehub/lobehub#30', 'call-30'));
    await model.registerExternal(pr('lobehub/lobehub#31', 'call-31'));
    // The same PR touched by both topics is listed for each.
    await model.registerExternal(
      pr('lobehub/lobehub#30', 'call-30-second', {
        changeType: 'updated',
        patchFields: ['identifier', 'status'],
        status: 'merged',
        topicId: secondTopicId,
      }),
    );
    await new WorkModel(serverDB, userId2).registerExternal(
      pr('lobehub/lobehub#32', 'call-user2', { topicId: secondTopicId }),
    );

    const byTopic = await model.listTopicsPullRequests([topicId, secondTopicId, emptyTopicId]);

    expect(byTopic.get(topicId)?.map((item) => item.number)).toEqual([31, 30]);
    expect(byTopic.get(secondTopicId)).toEqual([
      expect.objectContaining({ number: 30, source: 'command', status: 'merged' }),
    ]);
    expect(byTopic.has(emptyTopicId)).toBe(false);
    expect((await model.listTopicsPullRequests([])).size).toBe(0);
  });
});

describe('WorkModel.listTopicPullRequests with a work that lost its resource id', () => {
  it('skips a row whose pull-request identifier is gone', async () => {
    await serverDB.insert(works).values({
      id: 'work-null-resource',
      resourceId: null,
      resourceType: 'github_pull_request',
      toolIdentifier: 'github',
      toolName: 'create_pull_request',
      type: 'external',
      userId,
      visibility: 'private',
    });
    await serverDB.insert(workVersions).values({
      changeType: 'created',
      toolIdentifier: 'claude-code',
      toolName: 'Bash',
      topicId,
      version: 1,
      workId: 'work-null-resource',
    });

    const rows = await new WorkModel(serverDB, userId).listTopicPullRequests(topicId);

    expect(rows.map((row) => row.workId)).not.toContain('work-null-resource');
  });
});
