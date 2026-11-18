// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { WorkModel } from '../../../models/work';
import { works, workVersions } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reply-works');
const execution = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** A member asks the Agent and its reply is published from the member's own run. */
const publishedReply = async () => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Agent');
  const request = await team.asMember.send(team.channel.id, {
    content: 'Open a PR',
    mentions: [agent.id],
    requestKey: 'question',
    routing: 'fallback',
  });
  const [job] = await jobsOf(db, request.id);
  await execution.claim(team.channel.id, job.id, lease);
  await execution.accepted(team.channel.id, job.id);
  await execution.saveDraft(team.channel.id, job.id, 'Opened it');
  await execution.publish(team.channel.id, job.id);
  await execution.releaseWriter(team.channel.id, job.id);
  const { operationId } = await jobById(db, job.id);
  const reply = async (repo: typeof team.asOwner, threadId?: string) => {
    const view = await repo.detail(team.channel.id, threadId ? { threadId } : undefined);
    return threadId
      ? view.rootMessage!
      : view.messages.find((message) => message.routingStatus === 'reply')!;
  };
  return { ...team, operationId: operationId!, reply, request };
};

interface WorkFixture {
  at?: Date;
  cost?: number;
  metadata?: Record<string, unknown>;
  ownerId?: string;
  resourceType?: string;
  rootOperationId: string;
  share?: boolean;
  tokens?: number;
  trashed?: boolean;
  type?: 'document' | 'external';
  url?: string | null;
}

const addWork = async ({
  at,
  cost,
  metadata,
  ownerId = fixture.memberId,
  resourceType = 'github_pull_request',
  rootOperationId,
  share = false,
  trashed = false,
  tokens,
  type = 'external',
  url = 'https://github.com/lobehub/lobehub/pull/1',
}: WorkFixture) => {
  const [work] = await db
    .insert(works)
    .values({
      description: 'Adds the cards',
      identifier: 'lobehub/lobehub#1',
      isDeleted: trashed,
      updatedAt: at,
      metadata: share
        ? ({
            agentShare: { shareId: 's', topicId: 't', visitorUserId: 'v' },
          } as typeof works.$inferInsert.metadata)
        : null,
      resourceId: `${resourceType}:${Math.random()}`,
      resourceType: resourceType as typeof works.$inferInsert.resourceType,
      status: 'open',
      title: 'Show works in channels',
      toolIdentifier: 'github',
      toolName: 'createPullRequest',
      type,
      url,
      userId: ownerId,
      visibility: 'private',
      workspaceId: fixture.workspaceId,
    })
    .returning();
  const [version] = await db
    .insert(workVersions)
    .values({
      changeType: 'created',
      createdAt: at,
      cumulativeCost: cost ?? null,
      cumulativeUsage:
        tokens === undefined
          ? null
          : { capturedAt: '2026-11-12T00:00:00Z', usage: { llm: { tokens: { total: tokens } } } },
      metadata: metadata as typeof workVersions.$inferInsert.metadata,
      rootOperationId,
      toolIdentifier: 'github',
      toolName: 'createPullRequest',
      url,
      version: 1,
      workId: work.id,
    })
    .returning();
  await db.update(works).set({ currentVersionId: version.id }).where(eq(works.id, work.id));
  return work;
};

describe('Channel reply works', () => {
  it('shows every member the conversation summaries of the reply run, without its ids', async () => {
    const state = await publishedReply();
    const work = await addWork({
      cost: 0.42,
      metadata: { baseBranch: 'canary', headBranch: 'feat/cards' },
      rootOperationId: state.operationId,
      tokens: 1200,
    });
    // A later run of the requester's on the same PR: the card totals it, as the conversation does.
    await db.insert(workVersions).values({
      changeType: 'updated',
      cumulativeCost: 0.1,
      rootOperationId: 'op_later_run',
      toolIdentifier: 'github',
      toolName: 'updatePullRequest',
      version: 2,
      workId: work.id,
    });
    const [conversation] = (
      await new WorkModel(db, fixture.memberId, fixture.workspaceId).listSummariesByRootOperations({
        rootOperationIds: [state.operationId],
      })
    )[state.operationId];

    for (const repo of [state.asMember, state.asOwner]) {
      const [card] = (await state.reply(repo)).works!;
      expect(card).toEqual({
        ...conversation,
        currentVersionId: null,
        event: {
          ...conversation.event,
          id: '',
          messageId: null,
          rootOperationId: null,
          toolCallId: null,
        },
        id: 'https://github.com/lobehub/lobehub/pull/1',
        originAgentId: null,
        originThreadId: null,
        originTopicId: null,
        userId: '',
        version: null,
        workspaceId: null,
      });
      expect(card).toMatchObject({
        event: {
          cumulativeUsage: { usage: { llm: { tokens: { total: 1200 } } } },
          metadata: { baseBranch: 'canary', headBranch: 'feat/cards' },
        },
        identifier: 'lobehub/lobehub#1',
        title: 'Show works in channels',
        totalCost: 0.52,
      });
      const payload = JSON.stringify(card);
      expect(payload).not.toContain(work.id);
      expect(payload).not.toContain(state.operationId);
      expect(payload).not.toContain(fixture.memberId);
    }
  });

  it('keeps internal, unlinked, shared, trashed and foreign Works out', async () => {
    const state = await publishedReply();
    await addWork({
      resourceType: 'document',
      rootOperationId: state.operationId,
      type: 'document',
    });
    await addWork({ rootOperationId: state.operationId, url: null });
    await addWork({ rootOperationId: state.operationId, share: true });
    await addWork({ rootOperationId: state.operationId, trashed: true });
    await addWork({ ownerId: fixture.ownerId, rootOperationId: state.operationId });
    await addWork({ rootOperationId: 'op_another_run' });

    expect((await state.reply(state.asOwner)).works).toEqual([]);
  });

  it('lists the newest Works first and leaves requests without any', async () => {
    const state = await publishedReply();
    await addWork({
      at: new Date('2026-11-12T10:00:00Z'),
      rootOperationId: state.operationId,
      url: 'https://github.com/a/b/pull/1',
    });
    await addWork({
      at: new Date('2026-11-12T10:05:00Z'),
      resourceType: 'linear_issue',
      rootOperationId: state.operationId,
      url: 'https://linear.app/x/issue/ENG-1',
    });

    const reply = await state.reply(state.asOwner);
    expect(reply.works?.map((card) => card.url)).toEqual([
      'https://linear.app/x/issue/ENG-1',
      'https://github.com/a/b/pull/1',
    ]);
    expect(reply.works?.[0]).toMatchObject({ event: { cumulativeUsage: null }, totalCost: null });
    const request = (await state.asOwner.detail(state.channel.id)).messages.find(
      (message) => message.id === state.request.id,
    )!;
    expect(request.works).toEqual([]);
  });

  it('carries the Works on a thread root', async () => {
    const state = await publishedReply();
    await addWork({ rootOperationId: state.operationId });
    const reply = await state.reply(state.asOwner);
    const thread = await state.asOwner.createThread(state.channel.id, { rootMessageId: reply.id });

    expect((await state.reply(state.asOwner, thread.id)).works).toEqual([
      expect.objectContaining({ url: 'https://github.com/lobehub/lobehub/pull/1' }),
    ]);
  });
});
