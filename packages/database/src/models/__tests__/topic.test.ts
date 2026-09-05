// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  agents,
  chatGroups,
  messages,
  sessions,
  topics,
  users,
  workspaces,
} from '../../schemas';
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

    it('does not return an agent-share visitor topic by default (creator-facing scope)', async () => {
      await serverDB.insert(topics).values({
        id: 'topic-visitor-find',
        senderId: 'visitor-user-x',
        title: 'visitor topic',
        userId,
      });

      const found = await topicModel.findById('topic-visitor-find');
      expect(found).toBeUndefined();
    });

    it('returns an agent-share visitor topic when includeShareVisitor is opted in', async () => {
      await serverDB.insert(topics).values({
        id: 'topic-visitor-find-opted',
        senderId: 'visitor-user-x',
        title: 'visitor topic',
        userId,
      });

      const shareRuntimeModel = new TopicModel(serverDB, userId, undefined, undefined, {
        includeShareVisitor: true,
      });
      const found = await shareRuntimeModel.findById('topic-visitor-find-opted');
      expect(found?.id).toBe('topic-visitor-find-opted');
    });
  });

  describe('findOwnTopicById', () => {
    it('returns the creator’s own topic', async () => {
      const topic = await topicModel.create({ title: 'own' });

      const found = await topicModel.findOwnTopicById(topic.id);
      expect(found?.id).toBe(topic.id);
    });

    it('excludes an agent-share visitor topic', async () => {
      // Visitor topics carry the creator's userId, so ownership alone would let
      // the creator read a visitor conversation from a raw topic id.
      await serverDB.insert(topics).values({
        id: 'topic-visitor-find-own',
        senderId: 'visitor-user-x',
        title: 'visitor topic',
        userId,
      });

      const found = await topicModel.findOwnTopicById('topic-visitor-find-own');
      expect(found).toBeUndefined();
    });
  });

  describe('findOwnTopicsByIds', () => {
    it('returns the creator’s own topics', async () => {
      const topic = await topicModel.create({ title: 'own' });

      const found = await topicModel.findOwnTopicsByIds([topic.id]);
      expect(found.map((t) => t.id)).toEqual([topic.id]);
    });

    it('excludes an agent-share visitor topic from a mixed batch', async () => {
      // Visitor topics carry the creator's userId, so ownership alone would let
      // the creator read a visitor conversation from a raw topic id.
      const own = await topicModel.create({ title: 'own' });
      await serverDB.insert(topics).values({
        id: 'topic-visitor-find-own-ids',
        senderId: 'visitor-user-x',
        title: 'visitor topic',
        userId,
      });

      const found = await topicModel.findOwnTopicsByIds([own.id, 'topic-visitor-find-own-ids']);

      expect(found.map((t) => t.id)).toEqual([own.id]);
    });
  });

  describe('findShareVisitorTopicIds', () => {
    it('reports only the visitor ids of a mixed batch', async () => {
      // Creator-facing update RPCs diff their targets against this finder, so
      // it must name visitor rows and stay silent about the creator's own.
      const own = await topicModel.create({ title: 'own' });
      await serverDB.insert(topics).values({
        id: 'topic-visitor-ids',
        senderId: 'visitor-user-x',
        title: 'visitor topic',
        userId,
      });

      const visitorIds = await topicModel.findShareVisitorTopicIds([own.id, 'topic-visitor-ids']);

      expect(visitorIds).toEqual(['topic-visitor-ids']);
    });

    it('ignores ids that match no row', async () => {
      const visitorIds = await topicModel.findShareVisitorTopicIds(['topic-missing']);

      expect(visitorIds).toEqual([]);
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

    it('excludes agent-share visitor topics from the agentId branch', async () => {
      // Agent-share visitor topics keep the CREATOR's userId (so plain
      // ownership matches them) but carry a non-null senderId. The creator's
      // own topic sidebar (`query({ agentId })`) must never surface them —
      // only the visitor-scoped `queryBySender` should.
      await serverDB.insert(agents).values({ id: 'agent-share', userId });
      await serverDB.insert(topics).values([
        { agentId: 'agent-share', id: 't-creator', title: 'creator', userId },
        {
          agentId: 'agent-share',
          id: 't-visitor',
          senderId: 'visitor-user-x',
          title: 'visitor',
          userId,
        },
      ]);

      const { items, total } = await topicModel.query({ agentId: 'agent-share' });
      expect(items.map((t) => t.id)).toEqual(['t-creator']);
      expect(total).toBe(1);

      const visitorItems = await topicModel.queryBySender({
        agentId: 'agent-share',
        senderId: 'visitor-user-x',
      });
      expect(visitorItems.map((t) => t.id)).toEqual(['t-visitor']);
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

  describe('queryBySender', () => {
    it('projects only the visitor-safe runningOperation fields, stripping the rest of metadata', async () => {
      await serverDB.insert(agents).values({ id: 'agent-share-running', userId });
      await serverDB.insert(topics).values({
        agentId: 'agent-share-running',
        id: 't-visitor-running',
        metadata: {
          // Creator-only fields that must never reach a visitor.
          model: 'gpt-4',
          runningOperation: {
            assistantMessageId: 'ast-1',
            deviceId: 'device-1',
            heteroType: 'claude-code',
            hooks: [{ event: 'onComplete', type: 'webhook', url: 'https://example.com' } as any],
            operationId: 'op-1',
            scope: 'main',
            threadId: 'thd-1',
          },
        },
        senderId: 'visitor-user-running',
        title: 'running',
        userId,
      });

      const [item] = await topicModel.queryBySender({
        agentId: 'agent-share-running',
        senderId: 'visitor-user-running',
      });

      expect(item.runningOperation).toEqual({
        assistantMessageId: 'ast-1',
        heteroType: 'claude-code',
        operationId: 'op-1',
        scope: 'main',
        threadId: 'thd-1',
      });
      expect(item).not.toHaveProperty('metadata');
    });

    it('returns a null runningOperation when the topic has no active run', async () => {
      await serverDB.insert(agents).values({ id: 'agent-share-idle', userId });
      await serverDB.insert(topics).values({
        agentId: 'agent-share-idle',
        id: 't-visitor-idle',
        senderId: 'visitor-user-idle',
        title: 'idle',
        userId,
      });

      const [item] = await topicModel.queryBySender({
        agentId: 'agent-share-idle',
        senderId: 'visitor-user-idle',
      });

      expect(item.runningOperation).toBeNull();
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

    it('excludes agent-share visitor topics', async () => {
      await serverDB.insert(topics).values([
        { id: 'qt-creator', status: 'running', title: 'creator', userId },
        {
          id: 'qt-visitor',
          senderId: 'visitor-user-x',
          status: 'running',
          title: 'visitor',
          userId,
        },
      ]);

      const result = await topicModel.queryTopics({ statuses: ['running'] });
      expect(result.map((t) => t.id)).toEqual(['qt-creator']);
    });

    it('omits the last assistant message unless asked for it', async () => {
      await serverDB.insert(topics).values({ id: 't-lm', status: 'unread', title: 'lm', userId });
      await serverDB.insert(messages).values({
        content: 'the answer',
        id: 'lm-1',
        role: 'assistant',
        topicId: 't-lm',
        userId,
      });

      const [topic] = await topicModel.queryTopics({ statuses: ['unread'] });
      expect(topic).not.toHaveProperty('lastAssistantMessage');
    });

    it('pulls the latest non-empty assistant message per topic with withLastMessage', async () => {
      await serverDB.insert(topics).values([
        { id: 't-a', status: 'unread', title: 'a', userId },
        { id: 't-b', status: 'unread', title: 'b', userId },
      ]);
      await serverDB.insert(messages).values([
        // Newest assistant turn of t-a carried only tool calls (empty content) —
        // the preview must fall back to the last thing it actually said.
        {
          content: '',
          createdAt: new Date('2026-01-04'),
          id: 'a-3',
          role: 'assistant',
          topicId: 't-a',
          userId,
        },
        {
          content: 'a: final answer',
          createdAt: new Date('2026-01-03'),
          id: 'a-2',
          role: 'assistant',
          topicId: 't-a',
          userId,
        },
        {
          content: 'a: earlier answer',
          createdAt: new Date('2026-01-02'),
          id: 'a-1',
          role: 'assistant',
          topicId: 't-a',
          userId,
        },
        // A user message is never a candidate, even when it is the latest turn.
        {
          content: 'a: user follow-up',
          createdAt: new Date('2026-01-05'),
          id: 'a-user',
          role: 'user',
          topicId: 't-a',
          userId,
        },
      ]);

      const result = await topicModel.queryTopics({
        statuses: ['unread'],
        withLastMessage: true,
      });
      const byId = Object.fromEntries(result.map((t) => [t.id, t]));

      expect(byId['t-a'].lastAssistantMessage).toBe('a: final answer');
      // A topic with no assistant reply yet still comes back — just without one.
      expect(byId['t-b'].lastAssistantMessage).toBeNull();
    });

    it('marks an over-long reply as truncated instead of cutting it silently', async () => {
      await serverDB.insert(topics).values({ id: 't-long', status: 'unread', title: 'l', userId });
      await serverDB.insert(messages).values({
        content: 'x'.repeat(2500),
        id: 'long-1',
        role: 'assistant',
        topicId: 't-long',
        userId,
      });

      const [topic] = await topicModel.queryTopics({
        statuses: ['unread'],
        withLastMessage: true,
      });

      expect(topic.lastAssistantMessage).toBe(`${'x'.repeat(2000)}…`);
    });

    it('resolves runStartedAt from the latest top-level running operation', async () => {
      await serverDB.insert(topics).values([
        { id: 't-run', status: 'running', title: 'run', userId },
        { id: 't-no-op', status: 'running', title: 'no op', userId },
      ]);
      await serverDB.insert(agentOperations).values([
        // Abandoned row from a crashed earlier run — the live (later) one wins.
        {
          id: 'op-stale',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'running',
          topicId: 't-run',
          userId,
        },
        {
          id: 'op-live',
          startedAt: new Date('2026-01-02T00:00:00Z'),
          status: 'running',
          topicId: 't-run',
          userId,
        },
        // Sub-operation spawned later must not restart the clock.
        {
          id: 'op-sub',
          parentOperationId: 'op-live',
          startedAt: new Date('2026-01-03T00:00:00Z'),
          status: 'running',
          topicId: 't-run',
          userId,
        },
        // Finished op of the same topic is not the current run.
        {
          id: 'op-done',
          startedAt: new Date('2026-01-04T00:00:00Z'),
          status: 'done',
          topicId: 't-run',
          userId,
        },
      ]);

      const result = await topicModel.queryTopics({ statuses: ['running'] });
      const byId = Object.fromEntries(result.map((t) => [t.id, t]));

      expect(byId['t-run'].runStartedAt).toEqual(new Date('2026-01-02T00:00:00Z'));
      // A run that never wrote an operation row (e.g. client-mode) stays null.
      expect(byId['t-no-op'].runStartedAt).toBeNull();
    });

    it('never resurrects a timer for a non-running topic with a stale running op', async () => {
      await serverDB
        .insert(topics)
        .values({ id: 't-unread', status: 'unread', title: 'u', userId });
      await serverDB.insert(agentOperations).values({
        id: 'op-leftover',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'running',
        topicId: 't-unread',
        userId,
      });

      const [topic] = await topicModel.queryTopics({
        statuses: ['unread'],
        withLastMessage: true,
      });

      expect(topic.runStartedAt).toBeNull();
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

    it('excludes agent-share visitor topics', async () => {
      await serverDB.insert(topics).values([
        { id: 'count-creator', title: 'creator', userId },
        { id: 'count-visitor', senderId: 'visitor-user-x', title: 'visitor', userId },
      ]);

      expect(await topicModel.count()).toBe(1);
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

  describe('settleRunningStatus', () => {
    it("settles a running topic to 'unread' by default", async () => {
      const topic = await topicModel.create({ title: 'running run' });
      await topicModel.update(topic.id, { status: 'running' });

      const [settled] = await topicModel.settleRunningStatus(topic.id);
      expect(settled.status).toBe('unread');
    });

    it('never clobbers a status a client already wrote', async () => {
      // Regression: heteroFinish settles server-side after the terminal stream
      // event; a renderer that received the same event may have written
      // 'active'/'unread' first. The guard must turn the late settle into a
      // no-op instead of reverting the client's write.
      const topic = await topicModel.create({ title: 'client settled first' });
      await topicModel.update(topic.id, { status: 'active' });

      const result = await topicModel.settleRunningStatus(topic.id);
      expect(result).toHaveLength(0);

      const [row] = await serverDB.select().from(topics).where(eq(topics.id, topic.id));
      expect(row.status).toBe('active');
    });

    it('does not settle a topic owned by another user', async () => {
      await serverDB.insert(topics).values({
        id: 't-foreign-settle',
        status: 'running',
        title: 'foreign running',
        userId: otherUserId,
      });

      const result = await topicModel.settleRunningStatus('t-foreign-settle');
      expect(result).toHaveLength(0);

      const [row] = await serverDB.select().from(topics).where(eq(topics.id, 't-foreign-settle'));
      expect(row.status).toBe('running');
    });
  });

  describe('settleRunningOperation', () => {
    it('atomically clears and settles the matching operation', async () => {
      const hooks = [
        {
          id: 'hook-old',
          type: 'onComplete',
          webhook: { url: '/callback' },
        },
      ];
      const topic = await topicModel.create({
        metadata: {
          heteroCurrentMsgId: { msgId: 'msg-current', operationId: 'op-old' },
          runningOperation: {
            assistantMessageId: 'msg-old',
            hooks,
            operationId: 'op-old',
            threadId: 'thread-old',
          },
        },
        title: 'matching operation',
      });
      await topicModel.update(topic.id, { status: 'running' });

      const settled = await topicModel.settleRunningOperation(topic.id, 'op-old');

      expect(settled).toEqual({
        assistantMessageId: 'msg-current',
        hooks,
        orchestrationRole: undefined,
        status: 'settled',
        threadId: 'thread-old',
      });
      const row = await topicModel.findById(topic.id);
      expect(row?.metadata?.lastSettledOperationId).toBe('op-old');
      expect(row?.metadata?.runningOperation).toBeNull();
      expect(row?.status).toBe('unread');
    });

    it('corrects unread to active only for the operation that most recently settled', async () => {
      const topic = await topicModel.create({
        metadata: {
          runningOperation: { assistantMessageId: 'msg-old', operationId: 'op-old' },
        },
        title: 'watched completion',
      });
      await topicModel.update(topic.id, { status: 'running' });

      await topicModel.settleRunningOperation(topic.id, 'op-old');
      const corrected = await topicModel.settleRunningOperation(topic.id, 'op-old', 'active');

      expect(corrected.status).toBe('corrected');
      expect((await topicModel.findById(topic.id))?.status).toBe('active');
    });

    it('does not let a watched correction from an old operation hide a newer run', async () => {
      const topic = await topicModel.create({
        metadata: {
          runningOperation: { assistantMessageId: 'msg-old', operationId: 'op-old' },
        },
        title: 'new run wins',
      });
      await topicModel.update(topic.id, { status: 'running' });
      await topicModel.settleRunningOperation(topic.id, 'op-old');
      await topicModel.update(topic.id, {
        metadata: {
          runningOperation: { assistantMessageId: 'msg-new', operationId: 'op-new' },
        },
        status: 'running',
      });

      const corrected = await topicModel.settleRunningOperation(topic.id, 'op-old', 'active');

      expect(corrected).toEqual({ activeOperationId: 'op-new', status: 'conflict' });
      const row = await topicModel.findById(topic.id);
      expect(row?.metadata?.runningOperation?.operationId).toBe('op-new');
      expect(row?.status).toBe('running');
    });

    it('uses the requested terminal status only for the matching operation', async () => {
      const topic = await topicModel.create({
        metadata: {
          runningOperation: { assistantMessageId: 'msg-old', operationId: 'op-old' },
        },
        title: 'active matching operation',
      });
      await topicModel.update(topic.id, { status: 'running' });

      await topicModel.settleRunningOperation(topic.id, 'op-old', 'active');

      const row = await topicModel.findById(topic.id);
      expect(row?.metadata?.runningOperation).toBeNull();
      expect(row?.status).toBe('active');
    });

    it('atomically removes only a matching child operation', async () => {
      const childHooks = [
        {
          id: 'hook-child',
          type: 'onComplete',
          webhook: { url: '/child-callback' },
        },
      ];
      const topic = await topicModel.create({
        metadata: {
          heteroCurrentMsgId: { msgId: 'msg-child-current', operationId: 'op-child' },
          runningOperation: {
            assistantMessageId: 'msg-parent',
            childOperations: [
              {
                assistantMessageId: 'msg-child',
                hooks: childHooks,
                operationId: 'op-child',
                orchestrationRole: 'member',
                threadId: 'thread-child',
              },
            ],
            operationId: 'op-parent',
            orchestrationRole: 'supervisor',
          },
        },
        title: 'matching child operation',
      });
      await topicModel.update(topic.id, { status: 'running' });

      const settled = await topicModel.settleRunningOperation(topic.id, 'op-child');

      expect(settled).toEqual({
        assistantMessageId: 'msg-child-current',
        hooks: childHooks,
        orchestrationRole: 'member',
        status: 'settled',
        threadId: 'thread-child',
      });
      const row = await topicModel.findById(topic.id);
      expect(row?.metadata?.runningOperation).toMatchObject({
        operationId: 'op-parent',
        orchestrationRole: 'supervisor',
      });
      expect(row?.metadata?.runningOperation?.childOperations).toEqual([]);
      expect(row?.status).toBe('running');
    });

    it('does not let an old watchdog settle a newer operation', async () => {
      const topic = await topicModel.create({
        metadata: {
          runningOperation: { assistantMessageId: 'msg-new', operationId: 'op-new' },
        },
        title: 'newer operation',
      });
      await topicModel.update(topic.id, { status: 'running' });

      const settled = await topicModel.settleRunningOperation(topic.id, 'op-old');

      expect(settled).toEqual({ activeOperationId: 'op-new', status: 'conflict' });
      const row = await topicModel.findById(topic.id);
      expect(row?.metadata?.runningOperation?.operationId).toBe('op-new');
      expect(row?.status).toBe('running');
    });

    it('does not settle an unmarked client-side run', async () => {
      const topic = await topicModel.create({ title: 'client operation' });
      await topicModel.update(topic.id, { status: 'running' });

      const settled = await topicModel.settleRunningOperation(topic.id, 'op-old');

      expect(settled).toEqual({ assistantMessageId: undefined, status: 'missing' });
      const row = await topicModel.findById(topic.id);
      expect(row?.status).toBe('running');
    });

    it('retains the operation-scoped assistant pointer after another terminal path cleared the marker', async () => {
      const topic = await topicModel.create({
        metadata: {
          heteroCurrentMsgId: { msgId: 'msg-current', operationId: 'op-old' },
          runningOperation: null,
        },
        title: 'already cleared operation',
      });

      const settled = await topicModel.settleRunningOperation(topic.id, 'op-old');

      expect(settled).toEqual({ assistantMessageId: 'msg-current', status: 'missing' });
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

    it('marks duplicated messages and resets the topic-level rollups', async () => {
      const usage = { cost: 0.05, totalInputTokens: 100, totalOutputTokens: 50 };
      const topic = await topicModel.create({ title: 'billed' });
      await serverDB
        .update(topics)
        .set({ totalCost: '0.05' as any, totalTokens: 150 })
        .where(eq(topics.id, topic.id));
      await serverDB.insert(messages).values([
        {
          content: 'answer',
          id: 'dup-billed',
          metadata: { performance: { tps: 42 }, usage },
          role: 'assistant',
          topicId: topic.id,
          usage,
          userId,
        },
      ]);

      const { topic: cloned, messages: clonedMessages } = await topicModel.duplicate(topic.id);

      // per-message figures are transcript facts and survive the copy...
      const clone = clonedMessages[0];
      expect(clone.usage).toEqual(usage);
      const metadata = clone.metadata as Record<string, unknown>;
      expect(metadata.usage).toEqual(usage);
      expect(metadata.performance).toEqual({ tps: 42 });
      // ...but the row is marked, so usage reports skip it
      expect(metadata.copied).toBe(true);

      // the topic rollup answers "what did this topic cost this scope", and a
      // fresh duplicate has spent nothing yet
      const clonedTopic = await serverDB.query.topics.findFirst({
        where: (t, { eq: is }) => is(t.id, cloned.id),
      });
      expect(clonedTopic?.totalCost).toBeNull();
      expect(clonedTopic?.totalTokens).toBeNull();
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

  describe('resetMemoryExtractStatus', () => {
    it('resets completed topics back to pending and clears the run state', async () => {
      await serverDB.insert(topics).values([
        {
          id: 'mem-reset-done',
          metadata: {
            userMemoryExtractRunState: {
              lastRunAt: '2026-08-19T01:00:00.000Z',
              messageCount: 3,
              processedMemoryCount: 2,
            },
            userMemoryExtractStatus: 'completed',
          },
          title: 'done',
          userId,
        },
        { id: 'mem-reset-pending', title: 'pending', userId },
      ]);

      await topicModel.resetMemoryExtractStatus();

      const done = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'mem-reset-done'),
      });
      expect(done?.metadata?.userMemoryExtractStatus).toBe('pending');
      expect(done?.metadata?.userMemoryExtractRunState).toEqual({});

      const pending = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'mem-reset-pending'),
      });
      expect(pending?.metadata?.userMemoryExtractStatus).toBeUndefined();
    });

    it('does not touch topics owned by other users', async () => {
      await serverDB.insert(topics).values([
        {
          id: 'mem-reset-mine',
          metadata: { userMemoryExtractStatus: 'completed' },
          title: 'mine',
          userId,
        },
        {
          id: 'mem-reset-other',
          metadata: { userMemoryExtractStatus: 'completed' },
          title: 'other',
          userId: otherUserId,
        },
      ]);

      await topicModel.resetMemoryExtractStatus();

      const [mine, other] = await Promise.all([
        serverDB.query.topics.findFirst({ where: eq(topics.id, 'mem-reset-mine') }),
        serverDB.query.topics.findFirst({ where: eq(topics.id, 'mem-reset-other') }),
      ]);
      expect(mine?.metadata?.userMemoryExtractStatus).toBe('pending');
      expect(other?.metadata?.userMemoryExtractStatus).toBe('completed');
    });

    it('resets topics across personal and workspace scopes for the same user', async () => {
      const workspaceId = 'topic-model-test-ws-reset';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'topic-model-test-ws-reset',
        primaryOwnerId: userId,
        slug: workspaceId,
      });

      await serverDB.insert(topics).values([
        {
          id: 'mem-reset-personal',
          metadata: { userMemoryExtractStatus: 'completed' },
          title: 'personal scope',
          userId,
          workspaceId: null,
        },
        {
          id: 'mem-reset-ws',
          metadata: { userMemoryExtractStatus: 'completed' },
          title: 'workspace scope',
          userId,
          workspaceId,
        },
        // Another user's workspace topic must stay untouched.
        {
          id: 'mem-reset-ws-other-user',
          metadata: { userMemoryExtractStatus: 'completed' },
          title: 'workspace scope other user',
          userId: otherUserId,
          workspaceId,
        },
      ]);

      await topicModel.resetMemoryExtractStatus();

      const [personal, ws, wsOther] = await Promise.all([
        serverDB.query.topics.findFirst({ where: eq(topics.id, 'mem-reset-personal') }),
        serverDB.query.topics.findFirst({ where: eq(topics.id, 'mem-reset-ws') }),
        serverDB.query.topics.findFirst({ where: eq(topics.id, 'mem-reset-ws-other-user') }),
      ]);
      expect(personal?.metadata?.userMemoryExtractStatus).toBe('pending');
      expect(ws?.metadata?.userMemoryExtractStatus).toBe('pending');
      expect(wsOther?.metadata?.userMemoryExtractStatus).toBe('completed');
    });
  });

  describe('scheduled run', () => {
    const scheduledRun = {
      createdAt: '2026-07-12T00:00:00.000Z',
      failedAssistantMessageId: 'assistant-failed',
      kind: 'resume_after_rate_limit' as const,
      rateLimit: { resetsAt: 100 },
      runAt: '2026-07-12T00:00:00.000Z',
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
          metadata: { scheduledRun: { ...scheduledRun, runAt: '2026-07-12T06:00:00.000Z' } },
          status: 'scheduled',
          title: 'future',
          userId,
        },
        // A delayed_start due at the same instant — the gate is kind-agnostic.
        {
          id: 'delayed-due',
          metadata: {
            scheduledRun: {
              createdAt: '2026-07-12T00:00:00.000Z',
              kind: 'delayed_start' as const,
              runAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
              userMessageId: 'user-scheduled',
            },
          },
          status: 'scheduled',
          title: 'delayed',
          userId,
        },
      ]);

      const due = await TopicModel.getDueScheduledTopics(
        serverDB,
        new Date('2026-07-12T00:01:00.000Z'),
      );
      expect(due.map((topic) => topic.id).sort()).toEqual(['delayed-due', 'scheduled-due']);

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

    it('arms status and payload together, so a scheduled topic always has something to run', async () => {
      const topic = await topicModel.create({ title: 'to schedule' });
      expect(topic.status).toBeNull();

      await topicModel.armScheduledRun(topic.id, {
        createdAt: '2026-07-12T00:00:00.000Z',
        kind: 'delayed_start',
        runAt: '2026-07-12T03:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
        userMessageId: 'user-scheduled',
      });

      const [armed] = await serverDB.select().from(topics).where(eq(topics.id, topic.id));
      expect(armed.status).toBe('scheduled');
      expect(armed.metadata?.scheduledRun).toMatchObject({
        kind: 'delayed_start',
        userMessageId: 'user-scheduled',
      });
    });

    it('still finds a continuation parked by the pre-`kind` version, which gated on resetsAt', async () => {
      // Upgrade day: these rows have no `runAt` at all. If the due query only
      // understood `runAt`, they would sit at `scheduled` forever.
      const legacy = {
        createdAt: '2026-07-12T00:00:00.000Z',
        failedAssistantMessageId: 'assistant-failed',
        reason: 'rate_limit',
        source: 'heterogeneous_agent',
        updatedAt: '2026-07-12T00:00:00.000Z',
        userMessageId: 'user-message',
      };
      await serverDB.insert(topics).values([
        {
          id: 'legacy-window-passed',
          // resetsAt is epoch SECONDS, and this window closed long ago.
          metadata: { scheduledRun: { ...legacy, rateLimit: { resetsAt: 1_768_000_000 } } as any },
          status: 'scheduled',
          title: 'legacy due',
          userId,
        },
        {
          id: 'legacy-no-reset',
          // The provider reported no reset — the old gate read that as "due now".
          metadata: { scheduledRun: legacy as any },
          status: 'scheduled',
          title: 'legacy no reset',
          userId,
        },
        {
          id: 'legacy-window-open',
          metadata: { scheduledRun: { ...legacy, rateLimit: { resetsAt: 4_102_444_800 } } as any },
          status: 'scheduled',
          title: 'legacy not yet due',
          userId,
        },
      ]);

      const due = await TopicModel.getDueScheduledTopics(
        serverDB,
        new Date('2026-07-12T00:01:00Z'),
      );
      const ids = due.map((topic) => topic.id);

      expect(ids).toContain('legacy-window-passed');
      expect(ids).toContain('legacy-no-reset');
      expect(ids).not.toContain('legacy-window-open');
    });

    it('never treats a scheduled topic with no runAt as due', async () => {
      const { runAt: _runAt, ...noRunAt } = scheduledRun;
      await serverDB.insert(topics).values({
        id: 'scheduled-no-run-at',
        metadata: { scheduledRun: noRunAt as any },
        status: 'scheduled',
        title: 'no runAt',
        userId,
      });

      const due = await TopicModel.getDueScheduledTopics(serverDB, new Date('2030-01-01'));
      expect(due.map((topic) => topic.id)).not.toContain('scheduled-no-run-at');
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

    it('re-points a pending run at a new failed message, preserving the claim and payload', async () => {
      await serverDB.insert(topics).values({
        id: 'scheduled-repoint',
        metadata: {
          scheduledRun: { ...scheduledRun, claim: { claimedAt: '', expiresAt: '', id: 'claim-1' } },
        },
        status: 'scheduled',
        title: 'repoint',
        userId,
      });

      await TopicModel.repointScheduledRunFailedMessage(
        serverDB,
        'scheduled-repoint',
        'assistant-retry-1',
        'claim-1',
      );

      const [row] = await serverDB.select().from(topics).where(eq(topics.id, 'scheduled-repoint'));
      // Only the failed-message pointer moves — the lease and the rest of the
      // payload must survive the merge.
      expect(row.metadata?.scheduledRun).toMatchObject({
        claim: { id: 'claim-1' },
        failedAssistantMessageId: 'assistant-retry-1',
        kind: 'resume_after_rate_limit',
        runAt: scheduledRun.runAt,
        userMessageId: 'user-message',
      });
    });

    it('does not let a stale dispatch attempt re-point a re-armed schedule', async () => {
      // The failed attempt's claim lease expired and the user (or a newer tick)
      // re-armed / re-claimed the schedule — the old writer must lose.
      await serverDB.insert(topics).values({
        id: 'scheduled-reclaimed',
        metadata: {
          scheduledRun: { ...scheduledRun, claim: { claimedAt: '', expiresAt: '', id: 'new' } },
        },
        status: 'scheduled',
        title: 'reclaimed',
        userId,
      });

      await TopicModel.repointScheduledRunFailedMessage(
        serverDB,
        'scheduled-reclaimed',
        'assistant-stale-attempt',
        'old',
      );

      const [row] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, 'scheduled-reclaimed'));
      expect(row.metadata?.scheduledRun).toMatchObject({
        claim: { id: 'new' },
        failedAssistantMessageId: 'assistant-failed',
      });
    });

    it('does not resurrect a cancelled schedule when re-pointing', async () => {
      await serverDB.insert(topics).values({
        id: 'scheduled-cancelled',
        metadata: { scheduledRun: null },
        status: 'active',
        title: 'cancelled',
        userId,
      });

      await TopicModel.repointScheduledRunFailedMessage(
        serverDB,
        'scheduled-cancelled',
        'assistant-retry-2',
        'claim-1',
      );

      const [row] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, 'scheduled-cancelled'));
      expect(row.metadata?.scheduledRun).toBeNull();
      expect(row.status).toBe('active');
    });
  });
});
