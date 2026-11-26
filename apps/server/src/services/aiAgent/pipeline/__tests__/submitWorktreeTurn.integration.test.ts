// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { generateEntityId } from '@lobechat/utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { TopicRepository } from '@/database/repositories/topic';
import { agents, messages, topics, users } from '@/database/schemas';

import { submitWorktreeTurn } from '../submitWorktreeTurn';

vi.mock('../precreatedTopic', () => ({
  resolvePrecreatedTopicSnapshot: async () => ({
    agentConfig: { agencyConfig: { executionTarget: 'auto' } },
    snapshot: { model: 'test-model', provider: 'test-provider' },
  }),
}));

const db = await getTestDB();
const userId = 'worktree-turn-test-user';
const agentId = generateEntityId('agents');
const deps = { db, resolveAgentConfigOrThrow: vi.fn(), userId };
const topicModel = new TopicModel(db, userId);
const topicRepo = new TopicRepository(db, userId);
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

  it('keeps the worktree request when the run consumes its reservation', async () => {
    const input = request();
    await submitWorktreeTurn(deps, input);
    const operationId = `op_worktree_${input.topicId}`;
    await operationModel.recordStart({
      agentId,
      metadata: { assistantMessageId: input.assistantMessageId },
      operationId,
      requireReservation: true,
      topicId: input.topicId,
    });
    await expect(operationModel.findById(operationId)).resolves.toMatchObject({
      metadata: {
        assistantMessageId: input.assistantMessageId,
        firstSendWorktree: { worktree: input.worktree },
      },
      status: 'running',
    });
  });

  it('persists the selected worktree device as explicit for later turns of an auto agent', async () => {
    const input = request();
    await submitWorktreeTurn(deps, input);

    expect((await topicModel.findById(input.topicId))?.metadata).toMatchObject({
      boundDeviceId: input.worktree.deviceId,
      deviceBindingPinned: true,
    });
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

  it('cancels an offline wait without deleting the message or allowing a late dispatch', async () => {
    const input = request();
    await submitWorktreeTurn(deps, input);
    const { topicId, userMessageId } = input;
    const operationId = `op_worktree_${topicId}`;
    const now = new Date();
    const claim = {
      claimedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5000).toISOString(),
      id: 'offline-check',
    };
    await expect(TopicModel.claimScheduledTopic(db, topicId, claim, now)).resolves.toBe(true);
    await expect(topicRepo.cancelWorktreeStart(topicId)).resolves.toBe('busy');

    const retryAt = new Date(now.getTime() + 30_000);
    await TopicModel.finishWorktreeStart(db, topicId, claim.id, {
      retryAt: retryAt.toISOString(),
      success: false,
    });
    await expect(
      new TopicRepository(db, 'foreign-user').cancelWorktreeStart(topicId),
    ).resolves.toBe('unchanged');
    await expect(topicRepo.cancelWorktreeStart(topicId)).resolves.toBe('cancelled');
    await expect(topicRepo.cancelWorktreeStart(topicId)).resolves.toBe('unchanged');
    expect(await TopicModel.getDueScheduledTopics(db, retryAt, topicId)).toHaveLength(0);
    await expect(TopicModel.claimScheduledTopic(db, topicId, claim, retryAt)).resolves.toBe(false);
    await expect(topicModel.findById(topicId)).resolves.toMatchObject({
      metadata: { scheduledRun: null },
      status: 'active',
    });
    await expect(messageModel.findById(userMessageId)).resolves.toMatchObject({
      content: input.prompt,
      role: 'user',
    });
    await expect(operationModel.findById(operationId)).resolves.toMatchObject({
      status: 'interrupted',
    });
  });

  it.each(['archived', 'trashed'] as const)(
    'records a late checkout for cleanup after the topic is %s',
    async (trigger) => {
      const input = request();
      await submitWorktreeTurn(deps, input);
      const now = new Date();
      const claim = {
        claimedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5000).toISOString(),
        id: 'checkout-worker',
      };
      await expect(TopicModel.claimScheduledTopic(db, input.topicId, claim, now)).resolves.toBe(
        true,
      );
      await db
        .update(topics)
        .set(trigger === 'trashed' ? { isDeleted: true } : { status: 'completed' })
        .where(eq(topics.id, input.topicId));
      const path = '/checkout/late';
      await expect(
        topicModel.recordFirstSendWorktreeCheckout(input.topicId, {
          claimId: claim.id,
          deviceId: input.worktree.deviceId,
          workingDirectoryConfig: {
            git: {
              activeWorktree: path,
              autoCreated: true,
              branch: 'lobehub/late',
              ownerNonce: 'saved-nonce',
            },
            path: input.worktree.sourcePath,
            repoType: 'git',
            sessionPath: path,
          },
        }),
      ).resolves.toEqual({ canDispatch: false, cleanupTrigger: trigger });
      const [owned] = await topicModel.findOwnedWorktreeTopics([input.topicId]);
      expect(owned.status).toBe(trigger === 'trashed' ? 'active' : 'completed');
      expect(owned.metadata).toMatchObject({
        ownedWorktrees: [
          {
            cleanup: { state: 'pending', trigger },
            deviceId: input.worktree.deviceId,
            ownerNonce: 'saved-nonce',
            path,
          },
        ],
        scheduledRun: null,
      });
      expect(owned.metadata?.workingDirectoryConfig).toBeUndefined();
      await expect(
        db.query.messages.findFirst({ where: eq(messages.id, input.userMessageId) }),
      ).resolves.toMatchObject({ content: input.prompt, topicId: input.topicId });
    },
  );

  it('shows a startup failure after the running marker has been rolled back', async () => {
    const input = request();
    await submitWorktreeTurn(deps, input);
    const now = new Date();
    const claim = {
      claimedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5000).toISOString(),
      id: 'startup-worker',
    };
    await expect(TopicModel.claimScheduledTopic(db, input.topicId, claim, now)).resolves.toBe(true);
    await db.update(topics).set({ status: 'active' }).where(eq(topics.id, input.topicId));

    await TopicModel.finishWorktreeStart(db, input.topicId, claim.id, {
      error: 'Could not prepare the resume session',
      success: false,
    });
    await expect(topicModel.findById(input.topicId)).resolves.toMatchObject({
      metadata: { scheduledRun: { error: 'Could not prepare the resume session' } },
      status: 'failed',
    });
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
