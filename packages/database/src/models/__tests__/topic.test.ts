// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, chatGroups, messages, sessions, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TopicModel } from '../topic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-model-test-user';
const otherUserId = 'topic-model-test-other-user';

const topicModel = new TopicModel(serverDB, userId);

const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000);

describe('TopicModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('create', () => {
    it('creates a topic owned by the calling user with null owner columns by default', async () => {
      const topic = await topicModel.create({ title: 'Hello' });

      expect(topic.title).toBe('Hello');
      expect(topic.userId).toBe(userId);
      expect(topic.agentId).toBeNull();
      expect(topic.sessionId).toBeNull();
      expect(topic.groupId).toBeNull();
      // personal mode → workspaceId stays null
      expect(topic.workspaceId).toBeNull();
    });

    it('coerces falsy owner ids to null', async () => {
      const topic = await topicModel.create({
        agentId: '',
        groupId: '',
        sessionId: '',
        title: 'falsy owners',
      });

      expect(topic.agentId).toBeNull();
      expect(topic.groupId).toBeNull();
      expect(topic.sessionId).toBeNull();
    });

    it('attaches given messages to the new topic in a transaction', async () => {
      await serverDB.insert(messages).values([
        { content: 'm1', id: 'msg-1', role: 'user', userId },
        { content: 'm2', id: 'msg-2', role: 'assistant', userId },
      ]);

      const topic = await topicModel.create({ messages: ['msg-1', 'msg-2'], title: 'with msgs' });

      const linked = await serverDB
        .select({ id: messages.id, topicId: messages.topicId })
        .from(messages)
        .where(eq(messages.topicId, topic.id));

      expect(linked.map((m) => m.id).sort()).toEqual(['msg-1', 'msg-2']);
    });
  });

  describe('batchCreate', () => {
    it('keeps a session topic session-scoped and a group topic group-scoped', async () => {
      await serverDB.insert(agents).values({ id: 'agent-b', userId });
      await serverDB.insert(sessions).values({ id: 'session-x', userId });
      await serverDB.insert(chatGroups).values({ id: 'group-b', userId });

      const created = await topicModel.batchCreate([
        { agentId: 'agent-b', sessionId: 'session-x', title: 'session topic' },
        { groupId: 'group-b', title: 'group topic' },
      ]);

      const bySession = created.find((t) => t.title === 'session topic')!;
      const byGroup = created.find((t) => t.title === 'group topic')!;

      // sessionId given (no groupId) → sessionId kept, groupId stays null
      expect(bySession.sessionId).toBe('session-x');
      expect(bySession.groupId).toBeNull();

      // groupId given (no sessionId) → groupId kept, sessionId stays null
      expect(byGroup.groupId).toBe('group-b');
      expect(byGroup.sessionId).toBeNull();
    });

    it('drops both owner ids when sessionId and groupId are passed together', async () => {
      await serverDB.insert(sessions).values({ id: 'session-both', userId });
      await serverDB.insert(chatGroups).values({ id: 'group-both', userId });

      // Each field is nulled based on the *other* being present, so passing both
      // detaches the topic from both — callers must pick exactly one.
      const [created] = await topicModel.batchCreate([
        { groupId: 'group-both', sessionId: 'session-both', title: 'ambiguous' },
      ]);

      expect(created.sessionId).toBeNull();
      expect(created.groupId).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the topic for the owner', async () => {
      const topic = await topicModel.create({ title: 'findable' });
      const found = await topicModel.findById(topic.id);
      expect(found?.id).toBe(topic.id);
    });

    it('does not return a topic owned by another user', async () => {
      await serverDB
        .insert(topics)
        .values({ id: 'topic-foreign', title: 'nope', userId: otherUserId });

      const found = await topicModel.findById('topic-foreign');
      expect(found).toBeUndefined();
    });
  });

  describe('query', () => {
    it('orders favorites first then by recent activity', async () => {
      await serverDB.insert(agents).values({ id: 'agent-q', userId });
      await serverDB.insert(topics).values([
        {
          agentId: 'agent-q',
          id: 't-fav',
          title: 'fav',
          favorite: true,
          updatedAt: minutesAgo(60),
          userId,
        },
        { agentId: 'agent-q', id: 't-new', title: 'new', updatedAt: minutesAgo(1), userId },
        { agentId: 'agent-q', id: 't-old', title: 'old', updatedAt: minutesAgo(30), userId },
      ]);

      const { items, total } = await topicModel.query({ agentId: 'agent-q' });

      expect(total).toBe(3);
      expect(items.map((t) => t.id)).toEqual(['t-fav', 't-new', 't-old']);
    });

    it('adopts orphan rows for the inbox agent only', async () => {
      await serverDB.insert(agents).values({ id: 'agent-inbox', slug: 'inbox', userId });
      await serverDB.insert(topics).values([
        { agentId: 'agent-inbox', id: 't-direct', title: 'direct', userId },
        // legacy orphan: every owner column null
        { id: 't-orphan', title: 'orphan', userId },
      ]);

      const inbox = await topicModel.query({ agentId: 'agent-inbox', isInbox: true });
      expect(inbox.items.map((t) => t.id).sort()).toEqual(['t-direct', 't-orphan']);

      const nonInbox = await topicModel.query({ agentId: 'agent-inbox' });
      expect(nonInbox.items.map((t) => t.id)).toEqual(['t-direct']);
    });

    it('filters by groupId directly', async () => {
      await serverDB.insert(chatGroups).values({ id: 'group-q', userId });
      await serverDB.insert(topics).values([
        { groupId: 'group-q', id: 't-g1', title: 'g1', userId },
        { id: 't-no-group', title: 'no group', userId },
      ]);

      const { items } = await topicModel.query({ groupId: 'group-q' });
      expect(items.map((t) => t.id)).toEqual(['t-g1']);
    });

    describe('status filtering & ordering', () => {
      it('excludes topics whose status is in excludeStatuses but keeps null status', async () => {
        await serverDB.insert(agents).values({ id: 'agent-s', userId });
        await serverDB.insert(topics).values([
          { agentId: 'agent-s', id: 't-active', status: 'active', title: 'active', userId },
          { agentId: 'agent-s', id: 't-done', status: 'completed', title: 'done', userId },
          { agentId: 'agent-s', id: 't-null', title: 'null status', userId },
        ]);

        const { items } = await topicModel.query({
          agentId: 'agent-s',
          excludeStatuses: ['completed'],
        });

        expect(items.map((t) => t.id).sort()).toEqual(['t-active', 't-null']);
      });

      it('orders by status priority floating unread above active/completed', async () => {
        await serverDB.insert(agents).values({ id: 'agent-rank', userId });
        // all share the same activity time so only the status rank decides order
        const at = minutesAgo(5);
        await serverDB.insert(topics).values([
          {
            agentId: 'agent-rank',
            id: 't-completed',
            status: 'completed',
            title: 'c',
            updatedAt: at,
            userId,
          },
          {
            agentId: 'agent-rank',
            id: 't-active',
            status: 'active',
            title: 'a',
            updatedAt: at,
            userId,
          },
          {
            agentId: 'agent-rank',
            id: 't-unread',
            status: 'unread',
            title: 'u',
            updatedAt: at,
            userId,
          },
          {
            agentId: 'agent-rank',
            id: 't-waiting',
            status: 'waitingForHuman',
            title: 'w',
            updatedAt: at,
            userId,
          },
        ]);

        const { items } = await topicModel.query({ agentId: 'agent-rank', sortBy: 'status' });

        // waitingForHuman(0) < unread(2) < active(4) < completed(6)
        expect(items.map((t) => t.id)).toEqual([
          't-waiting',
          't-unread',
          't-active',
          't-completed',
        ]);
      });
    });

    describe('trigger filtering', () => {
      beforeEach(async () => {
        await serverDB.insert(agents).values({ id: 'agent-trig', userId });
        await serverDB.insert(topics).values([
          { agentId: 'agent-trig', id: 't-chat', title: 'chat', trigger: 'chat', userId },
          { agentId: 'agent-trig', id: 't-cron', title: 'cron', trigger: 'cron', userId },
          { agentId: 'agent-trig', id: 't-none', title: 'none', userId },
        ]);
      });

      it('keeps only the requested triggers when `triggers` is set', async () => {
        const { items } = await topicModel.query({ agentId: 'agent-trig', triggers: ['cron'] });
        expect(items.map((t) => t.id)).toEqual(['t-cron']);
      });

      it('drops excluded triggers but keeps null-trigger topics', async () => {
        const { items } = await topicModel.query({
          agentId: 'agent-trig',
          excludeTriggers: ['cron'],
        });
        expect(items.map((t) => t.id).sort()).toEqual(['t-chat', 't-none']);
      });

      it('includeTriggers takes precedence over excludeTriggers', async () => {
        const { items } = await topicModel.query({
          agentId: 'agent-trig',
          excludeTriggers: ['cron'],
          includeTriggers: ['cron'],
        });
        expect(items.map((t) => t.id)).toEqual(['t-cron']);
      });
    });

    it('returns card-detail columns only when withDetails is set', async () => {
      await serverDB.insert(agents).values({ id: 'agent-d', userId });
      await serverDB.insert(topics).values({
        agentId: 'agent-d',
        description: 'desc',
        id: 't-detail',
        title: 'detail',
        trigger: 'chat',
        userId,
      });
      await serverDB.insert(messages).values([
        { content: 'first user message', id: 'dm-1', role: 'user', topicId: 't-detail', userId },
        { content: 'assistant reply', id: 'dm-2', role: 'assistant', topicId: 't-detail', userId },
      ]);

      const lean = await topicModel.query({ agentId: 'agent-d' });
      expect(lean.items[0]).not.toHaveProperty('firstUserMessage');
      expect(lean.items[0]).not.toHaveProperty('messageCount');

      const detailed = await topicModel.query({ agentId: 'agent-d', withDetails: true });
      expect(detailed.items[0]).toMatchObject({
        description: 'desc',
        firstUserMessage: 'first user message',
        messageCount: 2,
        trigger: 'chat',
      });
    });
  });

  describe('queryTopics', () => {
    it('filters by the given statuses and is scoped to the owner', async () => {
      await serverDB.insert(topics).values([
        { id: 't-running', status: 'running', title: 'r', userId },
        { id: 't-active', status: 'active', title: 'a', userId },
        { id: 't-running-other', status: 'running', title: 'ro', userId: otherUserId },
      ]);

      const result = await topicModel.queryTopics({ statuses: ['running'] });
      expect(result.map((t) => t.id)).toEqual(['t-running']);
    });

    it('returns all owned topics when no statuses filter is given', async () => {
      await serverDB.insert(topics).values([
        { id: 't1', status: 'running', title: '1', userId },
        { id: 't2', status: 'active', title: '2', userId },
      ]);

      const result = await topicModel.queryTopics();
      expect(result.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    });
  });

  describe('count', () => {
    it('counts all owned topics and can scope to an agent', async () => {
      await serverDB.insert(agents).values({ id: 'agent-c', userId });
      await serverDB.insert(topics).values([
        { agentId: 'agent-c', id: 'c1', title: '1', userId },
        { id: 'c2', title: '2', userId },
        { id: 'c-other', title: 'x', userId: otherUserId },
      ]);

      expect(await topicModel.count()).toBe(2);
      expect(await topicModel.count({ agentId: 'agent-c' })).toBe(1);
    });
  });

  describe('update', () => {
    it('updates status and bumps updatedAt', async () => {
      const topic = await topicModel.create({ title: 'to update' });
      const before = topic.updatedAt.getTime();

      const [updated] = await topicModel.update(topic.id, { status: 'unread' });
      expect(updated.status).toBe('unread');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before);

      const [cleared] = await topicModel.update(topic.id, { status: 'active' });
      expect(cleared.status).toBe('active');
    });

    it('does not update a topic owned by another user', async () => {
      await serverDB
        .insert(topics)
        .values({ id: 't-foreign-upd', status: 'active', title: 'foreign', userId: otherUserId });

      const result = await topicModel.update('t-foreign-upd', { status: 'unread' });
      expect(result).toHaveLength(0);

      const [row] = await serverDB.select().from(topics).where(eq(topics.id, 't-foreign-upd'));
      expect(row.status).toBe('active');
    });
  });

  describe('updateMetadata', () => {
    it('merges new metadata into existing metadata', async () => {
      const topic = await topicModel.create({
        metadata: { model: 'gpt-4', provider: 'openai' },
        title: 'meta',
      });

      const [updated] = await topicModel.updateMetadata(topic.id, { workingDirectory: '/tmp' });

      expect(updated.metadata).toMatchObject({
        model: 'gpt-4',
        provider: 'openai',
        workingDirectory: '/tmp',
      });
    });

    it('deep-merges the onboardingSession sub-object', async () => {
      const topic = await topicModel.create({
        metadata: {
          onboardingSession: {
            lastActiveAt: '2026-01-01',
            phase: 'discovery',
            startedAt: '2026-01-01',
            version: 1,
          },
        },
        title: 'onboarding',
      });

      const [updated] = await topicModel.updateMetadata(topic.id, {
        onboardingSession: { phase: 'summary' },
      });

      expect(updated.metadata?.onboardingSession).toMatchObject({
        lastActiveAt: '2026-01-01',
        phase: 'summary',
        startedAt: '2026-01-01',
        version: 1,
      });
    });
  });

  describe('delete', () => {
    it('deletes a single owned topic', async () => {
      const topic = await topicModel.create({ title: 'del' });
      await topicModel.delete(topic.id);
      expect(await topicModel.findById(topic.id)).toBeUndefined();
    });

    it('batch deletes only the given ids', async () => {
      await serverDB.insert(topics).values([
        { id: 'b1', title: '1', userId },
        { id: 'b2', title: '2', userId },
        { id: 'b3', title: '3', userId },
      ]);

      await topicModel.batchDelete(['b1', 'b2']);

      const remaining = await topicModel.queryTopics();
      expect(remaining.map((t) => t.id)).toEqual(['b3']);
    });

    it('deleteAll removes only the calling user rows', async () => {
      await serverDB.insert(topics).values([
        { id: 'mine-1', title: '1', userId },
        { id: 'theirs-1', title: '2', userId: otherUserId },
      ]);

      await topicModel.deleteAll();

      expect(await topicModel.queryTopics()).toHaveLength(0);
      const theirs = await serverDB.select().from(topics).where(eq(topics.id, 'theirs-1'));
      expect(theirs).toHaveLength(1);
    });

    it('batchDeleteByAgentId removes all topics under one agent', async () => {
      await serverDB.insert(agents).values([
        { id: 'agent-del', userId },
        { id: 'agent-keep', userId },
      ]);
      await serverDB.insert(topics).values([
        { agentId: 'agent-del', id: 'd1', title: '1', userId },
        { agentId: 'agent-del', id: 'd2', title: '2', userId },
        { agentId: 'agent-keep', id: 'k1', title: '3', userId },
      ]);

      await topicModel.batchDeleteByAgentId('agent-del');

      const remaining = await topicModel.queryTopics();
      expect(remaining.map((t) => t.id)).toEqual(['k1']);
    });
  });

  describe('duplicate', () => {
    it('copies the topic and its messages under a new id', async () => {
      const topic = await topicModel.create({ title: 'original' });
      await serverDB.insert(messages).values([
        { content: 'hi', id: 'dup-m1', role: 'user', topicId: topic.id, userId },
        { content: 'yo', id: 'dup-m2', role: 'assistant', topicId: topic.id, userId },
      ]);

      const { topic: cloned, messages: clonedMessages } = await topicModel.duplicate(
        topic.id,
        'copy',
      );

      expect(cloned.id).not.toBe(topic.id);
      expect(cloned.title).toBe('copy');
      expect(clonedMessages).toHaveLength(2);
      expect(clonedMessages.every((m) => m.topicId === cloned.id)).toBe(true);
      expect(clonedMessages.map((m) => m.id)).not.toContain('dup-m1');
    });

    it('throws when the source topic does not exist', async () => {
      await expect(topicModel.duplicate('nope')).rejects.toThrow('not found');
    });
  });

  describe('batchMoveToAgent', () => {
    it('reassigns agentId, clears sessionId, and moves child messages', async () => {
      await serverDB.insert(agents).values([
        { id: 'agent-src', userId },
        { id: 'agent-dst', userId },
      ]);
      await serverDB.insert(topics).values({
        agentId: 'agent-src',
        id: 'move-1',
        sessionId: null,
        title: 'movable',
        userId,
      });
      await serverDB.insert(messages).values({
        agentId: 'agent-src',
        content: 'm',
        id: 'move-msg',
        role: 'user',
        topicId: 'move-1',
        userId,
      });

      await topicModel.batchMoveToAgent(['move-1'], 'agent-dst');

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, 'move-1'));
      expect(topic.agentId).toBe('agent-dst');
      expect(topic.sessionId).toBeNull();

      const [msg] = await serverDB.select().from(messages).where(eq(messages.id, 'move-msg'));
      expect(msg.agentId).toBe('agent-dst');
    });

    it('throws when the target agent is not accessible', async () => {
      await serverDB.insert(agents).values({ id: 'agent-foreign', userId: otherUserId });
      await serverDB.insert(topics).values({ id: 'move-x', title: 'x', userId });

      await expect(topicModel.batchMoveToAgent(['move-x'], 'agent-foreign')).rejects.toThrow(
        'not found or not accessible',
      );
    });

    it('is a no-op for an empty id list', async () => {
      await expect(topicModel.batchMoveToAgent([], 'whatever')).resolves.toBeUndefined();
    });
  });

  describe('getCronTopicsGroupedByCronJob', () => {
    it('groups cron-triggered topics by their cronJobId and skips topics without one', async () => {
      await serverDB.insert(agents).values({ id: 'agent-cron', userId });
      await serverDB.insert(topics).values([
        {
          agentId: 'agent-cron',
          id: 'cron-a1',
          metadata: { cronJobId: 'job-a' },
          title: 'a1',
          trigger: 'cron',
          userId,
        },
        {
          agentId: 'agent-cron',
          id: 'cron-a2',
          metadata: { cronJobId: 'job-a' },
          title: 'a2',
          trigger: 'cron',
          userId,
        },
        {
          agentId: 'agent-cron',
          id: 'cron-b1',
          metadata: { cronJobId: 'job-b' },
          title: 'b1',
          trigger: 'cron',
          userId,
        },
        // cron trigger but no cronJobId → excluded by the SQL filter
        {
          agentId: 'agent-cron',
          id: 'cron-nojob',
          metadata: {},
          title: 'nojob',
          trigger: 'cron',
          userId,
        },
      ]);

      const grouped = await topicModel.getCronTopicsGroupedByCronJob('agent-cron');
      const byJob = Object.fromEntries(grouped.map((g) => [g.cronJobId, g.topics.length]));

      expect(byJob).toEqual({ 'job-a': 2, 'job-b': 1 });
    });
  });

  describe('queryRecent', () => {
    it('orders recent topics by latest activity and tags type', async () => {
      await serverDB.insert(agents).values({ id: 'agent-recent', slug: 'inbox', userId });
      await serverDB.insert(chatGroups).values({ id: 'group-recent', userId });
      await serverDB.insert(topics).values([
        {
          agentId: 'agent-recent',
          id: 'r-agent',
          title: 'agent',
          updatedAt: minutesAgo(10),
          userId,
        },
        {
          groupId: 'group-recent',
          id: 'r-group',
          title: 'group',
          updatedAt: minutesAgo(1),
          userId,
        },
      ]);

      const result = await topicModel.queryRecent();
      expect(result.map((t) => t.id)).toEqual(['r-group', 'r-agent']);
      expect(result.find((t) => t.id === 'r-group')?.type).toBe('group');
      expect(result.find((t) => t.id === 'r-agent')?.type).toBe('agent');
    });
  });

  describe('listTopicsForMemoryExtractor', () => {
    it('omits topics already marked completed unless ignoreExtracted is set', async () => {
      await serverDB.insert(topics).values([
        { createdAt: minutesAgo(2), id: 'mem-pending', title: 'pending', userId },
        {
          createdAt: minutesAgo(1),
          id: 'mem-done',
          metadata: { userMemoryExtractStatus: 'completed' },
          title: 'done',
          userId,
        },
      ]);

      const pendingOnly = await topicModel.listTopicsForMemoryExtractor();
      expect(pendingOnly.map((t) => t.id)).toEqual(['mem-pending']);

      const all = await topicModel.listTopicsForMemoryExtractor({ ignoreExtracted: true });
      expect(all.map((t) => t.id).sort()).toEqual(['mem-done', 'mem-pending']);
    });

    it('countTopicsForMemoryExtractor matches the list length', async () => {
      await serverDB.insert(topics).values([
        { id: 'mem-1', title: '1', userId },
        {
          id: 'mem-2',
          metadata: { userMemoryExtractStatus: 'completed' },
          title: '2',
          userId,
        },
      ]);

      expect(await topicModel.countTopicsForMemoryExtractor()).toBe(1);
    });
  });

  describe('scheduled continuation', () => {
    const scheduledRun = {
      createdAt: '2026-07-12T00:00:00.000Z',
      failedAssistantMessageId: 'assistant-failed',
      rateLimit: { resetsAt: 100 },
      reason: 'rate_limit' as const,
      source: 'heterogeneous_agent' as const,
      updatedAt: '2026-07-12T00:00:00.000Z',
      userMessageId: 'user-message',
    };

    it('returns only due scheduled topics and atomically grants one live claim', async () => {
      await serverDB.insert(topics).values([
        {
          id: 'scheduled-due',
          metadata: { scheduledRun },
          status: 'scheduled',
          title: 'due',
          userId,
        },
        {
          id: 'scheduled-future',
          metadata: { scheduledRun: { ...scheduledRun, rateLimit: { resetsAt: 300 } } },
          status: 'scheduled',
          title: 'future',
          userId,
        },
      ]);

      const due = await TopicModel.getDueScheduledTopics(serverDB, new Date(200_000));
      expect(due.map((topic) => topic.id)).toEqual(['scheduled-due']);

      const claim = {
        claimedAt: '2026-07-12T00:00:00.000Z',
        expiresAt: '2026-07-12T00:05:00.000Z',
        id: 'claim-1',
      };
      expect(
        await TopicModel.claimScheduledTopic(
          serverDB,
          'scheduled-due',
          claim,
          new Date('2026-07-12T00:01:00.000Z'),
        ),
      ).toBe(true);
      expect(
        await TopicModel.claimScheduledTopic(
          serverDB,
          'scheduled-due',
          { ...claim, id: 'claim-2' },
          new Date('2026-07-12T00:01:00.000Z'),
        ),
      ).toBe(false);
    });

    it('does not let a stale dispatcher clear a cancelled or re-claimed schedule', async () => {
      await serverDB.insert(topics).values({
        id: 'scheduled-claimed',
        metadata: {
          scheduledRun: { ...scheduledRun, claim: { claimedAt: '', expiresAt: '', id: 'new' } },
        },
        status: 'scheduled',
        title: 'claimed',
        userId,
      });

      await TopicModel.clearScheduledRun(serverDB, 'scheduled-claimed', 'running', 'old');
      const [unchanged] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, 'scheduled-claimed'));
      expect(unchanged.status).toBe('scheduled');
      expect(unchanged.metadata?.scheduledRun?.claim?.id).toBe('new');

      await TopicModel.clearScheduledRun(serverDB, 'scheduled-claimed', 'running', 'new');
      const [cleared] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, 'scheduled-claimed'));
      expect(cleared.status).toBe('running');
      expect(cleared.metadata?.scheduledRun).toBeNull();
    });
  });
});
