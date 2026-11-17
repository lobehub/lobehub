// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { generateEntityId } from '@lobechat/utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { agents, topics, users } from '@/database/schemas';

import { submitWorktreeTurn } from '../submitWorktreeTurn';

vi.mock('../precreatedTopic', () => ({
  resolvePrecreatedTopicSnapshot: async () => ({
    agentConfig: {},
    snapshot: { model: 'test-model', provider: 'test-provider' },
  }),
}));

const db = await getTestDB();
const userId = 'worktree-turn-test-user';
const agentId = generateEntityId('agents');
const deps = { db, resolveAgentConfigOrThrow: vi.fn(), userId };
const topicModel = new TopicModel(db, userId);
const messageModel = new MessageModel(db, userId);
const operationModel = new AgentOperationModel(db, userId);

const request = () => ({
  agentId,
  assistantMessageId: generateEntityId('messages'),
  prompt: 'Run from this branch',
  topicId: generateEntityId('topics'),
  userMessageId: generateEntityId('messages'),
  worktree: {
    baseBranch: 'release',
    deviceId: 'dev_1',
    path: '/repo',
    repoType: 'git' as const,
    sourcePath: '/repo',
  },
});

beforeAll(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('submitWorktreeTurn', () => {
  it('commits the first message and worktree intent together and accepts a repeat of the same request', async () => {
    const input = request();
    const { topic } = await submitWorktreeTurn(deps, input);
    const run = topic.metadata?.scheduledRun;

    expect(topic.status).toBe('scheduled');
    expect(run).toMatchObject({ kind: 'worktree_start', userMessageId: input.userMessageId });
    expect(await messageModel.findById(input.userMessageId)).toMatchObject({
      content: input.prompt,
      role: 'user',
      topicId: input.topicId,
    });
    expect(
      await operationModel.findById(run!.kind === 'worktree_start' ? run!.operationId : ''),
    ).toMatchObject({
      metadata: { firstSendWorktree: { worktree: input.worktree } },
      status: 'idle',
      topicId: input.topicId,
    });

    await expect(submitWorktreeTurn(deps, input)).resolves.toMatchObject({
      topic: { id: input.topicId },
    });
    expect((await topicModel.findById(input.topicId))?.metadata?.scheduledRun).toEqual(run);
  });

  it('rolls back the topic when the first message cannot be inserted', async () => {
    const input = request();
    const otherTopic = request().topicId;
    await db.insert(topics).values({ agentId, id: otherTopic, userId });
    await messageModel.create(
      { agentId, content: 'already exists', role: 'user', topicId: otherTopic },
      input.userMessageId,
    );

    await expect(submitWorktreeTurn(deps, input)).rejects.toThrow();
    expect(await topicModel.findById(input.topicId)).toBeUndefined();
    expect(await operationModel.findById(`op_worktree_${input.topicId}`)).toBeNull();
  });

  it('leases a pending turn to one background worker and keeps it due after the device reconnects', async () => {
    const { topic } = await submitWorktreeTurn(deps, request());
    const now = new Date();
    const claim = {
      claimedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5000).toISOString(),
      id: 'first-worker',
    };
    await expect(TopicModel.claimScheduledTopic(db, topic.id, claim, now)).resolves.toBe(true);
    await expect(
      TopicModel.claimScheduledTopic(db, topic.id, { ...claim, id: 'other-worker' }, now),
    ).resolves.toBe(false);
    await TopicModel.finishWorktreeStart(db, topic.id, 'other-worker', { success: true });
    expect((await topicModel.findById(topic.id))?.status).toBe('scheduled');

    const retryAt = new Date(now.getTime() + 30_000);
    await TopicModel.finishWorktreeStart(db, topic.id, claim.id, {
      retryAt: retryAt.toISOString(),
      success: false,
    });
    expect(await TopicModel.getDueScheduledTopics(db, now, topic.id)).toHaveLength(0);
    expect(await TopicModel.getDueScheduledTopics(db, retryAt, topic.id)).toMatchObject([
      { metadata: { scheduledRun: { waitingForDevice: true } }, status: 'scheduled' },
    ]);
  });
});
