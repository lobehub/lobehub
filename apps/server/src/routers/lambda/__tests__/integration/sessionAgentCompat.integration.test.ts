// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { HomeRepository } from '@/database/repositories/home';
import {
  agents,
  agentsToSessions,
  messages,
  sessionGroups,
  sessions,
  topics,
  trashItems,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import { resolveAgentReference } from '@/server/services/agent/resolveReference';
import { after } from '@/server/utils/scheduleAfterResponse';

import { batchResolveAgentIdFromSessions, resolveContext } from '../../_helpers/resolveContext';
import { agentRouter } from '../../agent';
import { aiChatRouter } from '../../aiChat';
import { messageRouter } from '../../message';
import { sessionRouter } from '../../session';
import { topicRouter } from '../../topic';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

vi.hoisted(() => vi.stubEnv('FTS_SEARCH_PROVIDER', 'pg_like'));
afterAll(() => vi.unstubAllEnvs());

let db: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => db) }));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { getFileAccessUrl: vi.fn(async () => 'mock-url') };
  }),
}));

describe('native Session to Agent compatibility', () => {
  let userId: string;
  let otherUserId: string;
  const callers = (workspaceId?: string, viewer = userId) => {
    const ctx = { ...createTestContext(viewer), serverDB: db, workspaceId };
    return {
      agent: agentRouter.createCaller(ctx),
      aiChat: aiChatRouter.createCaller(ctx),
      message: messageRouter.createCaller(ctx),
      session: sessionRouter.createCaller(ctx),
      topic: topicRouter.createCaller(ctx),
    };
  };
  const legacy = async (workspaceId?: string) => {
    const [agent] = await db
      .insert(agents)
      .values({ userId, workspaceId, title: 'Legacy' })
      .returning();
    const [session] = await db
      .insert(sessions)
      .values({ userId, workspaceId, type: 'agent' })
      .returning();
    await db
      .insert(agentsToSessions)
      .values({ agentId: agent.id, sessionId: session.id, userId, workspaceId });
    return { agent, session };
  };
  const workspace = async () => {
    const [row] = await db
      .insert(workspaces)
      .values({ name: 'Compat', slug: userId, primaryOwnerId: userId })
      .returning();
    await db.insert(workspaceMembers).values([
      { workspaceId: row.id, userId, role: 'owner' },
      { workspaceId: row.id, userId: otherUserId, role: 'member' },
    ]);
    return row.id;
  };

  beforeEach(async () => {
    db = await getTestDB();
    userId = await createTestUser(db);
    otherUserId = await createTestUser(db);
  });
  afterEach(async () => {
    await cleanupTestUser(db, otherUserId);
    await cleanupTestUser(db, userId);
  });

  it('creates a blank Agent with the native envelope and no Session or mapping rows', async () => {
    const caller = callers();
    const id = await caller.session.createSession({ type: 'agent', config: {}, session: {} });
    expect(id).toMatch(/^agt_/);
    expect(await db.query.agents.findFirst({ where: eq(agents.id, id) })).toMatchObject({
      id,
      userId,
    });
    expect(await db.query.sessions.findMany({ where: eq(sessions.userId, userId) })).toEqual([]);
    expect(
      await db.query.agentsToSessions.findMany({ where: eq(agentsToSessions.userId, userId) }),
    ).toEqual([]);
    expect(await caller.agent.getAgentConfigById({ agentId: id })).toMatchObject({ id });
  });

  it('imports market configuration and metadata while ignoring full-default and server-owned fields', async () => {
    const payload = {
      type: 'agent' as const,
      config: {
        model: 'model-market',
        provider: 'openai',
        params: { temperature: 0.4 },
        systemRole: 'Market role',
        plugins: ['search'],
        chatConfig: { historyCount: 7 },
        openingMessage: 'Welcome',
        openingQuestions: ['Hi'],
        tts: { voice: { openai: 'alloy' } },
        title: 'Market',
        avatar: 'avatar',
        description: 'Description',
        backgroundColor: '#123456',
        tags: ['tag'],
        identifier: 'market-identifier',
        examples: [{ role: 'user', content: 'example' }],
        metadata: { source: 'discover' },
        id: 'agt_injected',
        userId: otherUserId,
        workspaceId: 'foreign',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        slug: 'inbox',
        isDeleted: true,
      },
      session: {
        id: 'ssn_injected',
        userId: otherUserId,
        type: 'agent',
        pinned: true,
        groupId: 'default',
        createdAt: 0,
        updatedAt: 0,
      },
    };
    const id = await callers().session.createSession(payload);
    const row = await db.query.agents.findFirst({ where: eq(agents.id, id) });
    expect(row).toMatchObject({
      userId,
      workspaceId: null,
      pinned: true,
      sessionGroupId: null,
      model: 'model-market',
      provider: 'openai',
      params: { temperature: 0.4 },
      systemRole: 'Market role',
      plugins: ['search'],
      chatConfig: { historyCount: 7 },
      openingMessage: 'Welcome',
      openingQuestions: ['Hi'],
      tts: payload.config.tts,
      title: 'Market',
      avatar: 'avatar',
      description: 'Description',
      backgroundColor: '#123456',
      tags: ['tag'],
      marketIdentifier: 'market-identifier',
      fewShots: payload.config.examples,
      metadata: { source: 'discover' },
      isDeleted: null,
    });
    expect(row?.id).not.toBe('agt_injected');
    expect(row?.slug).not.toBe('inbox');
    expect(row!.createdAt.getTime()).toBeGreaterThan(0);
    expect(await db.query.sessions.findMany({ where: eq(sessions.userId, userId) })).toEqual([]);
  });

  it('uses the same folder visibility and resource permissions as agent.createAgent', async () => {
    const workspaceId = await workspace();
    const [folder] = await db
      .insert(sessionGroups)
      .values({ name: 'Private', userId, workspaceId, visibility: 'private' })
      .returning();
    const caller = callers(workspaceId);
    const id = await caller.session.createSession({
      type: 'agent',
      config: {},
      session: { groupId: folder.id },
    });
    expect(await db.query.agents.findFirst({ where: eq(agents.id, id) })).toMatchObject({
      sessionGroupId: folder.id,
      visibility: 'private',
      workspaceId,
    });
    await expect(
      caller.session.createSession({
        type: 'agent',
        config: { visibility: 'public' },
        session: { groupId: folder.id },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const publicId = await caller.session.createSession({ type: 'agent', config: {}, session: {} });
    expect(
      await new ResourcePermissionModel(db, workspaceId).getEffectiveAccessLevel('agent', publicId),
    ).toBe('edit');
    await expect(
      callers(workspaceId, otherUserId).session.createSession({
        type: 'agent',
        config: {},
        session: { groupId: folder.id },
      }),
    ).rejects.toThrow();
  });

  it.each(['legacy', 'new'] as const)(
    'keeps the %s context usable for config, topics, messages, updates and touch',
    async (kind) => {
      const caller = callers();
      const previous = kind === 'legacy' ? await legacy() : undefined;
      const id =
        previous?.session.id ??
        (await caller.session.createSession({ type: 'agent', config: {}, session: {} }));
      const agentId = previous?.agent.id ?? id;
      expect(await caller.agent.getAgentConfigById({ agentId: id })).toMatchObject({ id: agentId });
      expect(await caller.agent.getAgentConfig({ sessionId: id })).toMatchObject({ id: agentId });
      await caller.agent.updateAgentConfig({ agentId: id, value: { title: 'Updated config' } });
      expect(await db.query.agents.findFirst({ where: eq(agents.id, agentId) })).toMatchObject({
        title: 'Updated config',
      });
      const topicId = await caller.topic.createTopic({ sessionId: id, title: 'Native topic' });
      const result = await caller.message.createMessage({
        sessionId: id,
        topicId,
        role: 'user',
        content: 'Native message',
      });
      expect(result).toHaveProperty('id');
      expect(await db.query.topics.findFirst({ where: eq(topics.id, topicId) })).toMatchObject({
        agentId,
        sessionId: previous?.session.id ?? null,
      });
      expect((await caller.topic.getTopics({ agentId: id })).items.map((row) => row.id)).toContain(
        topicId,
      );
      expect(
        (await caller.topic.getTopics({ sessionId: id })).items.map((row) => row.id),
      ).toContain(topicId);
      for (const context of [{ agentId: id }, { sessionId: id }]) {
        expect(
          (await caller.message.getMessages({ ...context, topicId })).map((row) => row.content),
        ).toContain('Native message');
      }
      expect(
        (await caller.message.getMessagesByCursor({ agentId: id, topicId })).messages.map(
          (row) => row.content,
        ),
      ).toContain('Native message');
      const send = await caller.aiChat.sendMessageInServer({
        sessionId: id,
        newUserMessage: { content: 'Native send' },
        newAssistantMessage: { agentId: id, model: 'model-market', provider: 'openai' },
        newTopic: { title: 'Send topic', topicMessageIds: [] },
      });
      expect(send).toHaveProperty('topicId');
      const sent = await db.query.messages.findMany({ where: eq(messages.topicId, send.topicId!) });
      expect(sent).toHaveLength(2);
      expect(sent.every((row) => row.agentId === agentId)).toBe(true);
      await db
        .update(agents)
        .set({ updatedAt: new Date(0) })
        .where(eq(agents.id, agentId));
      const before = Date.now();
      await caller.session.updateSession({
        id,
        value: { updatedAt: new Date(0), groupId: undefined, pinned: undefined },
      });
      const touched = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
      expect(touched!.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      if (previous)
        expect(
          (await db.query.sessions.findFirst({ where: eq(sessions.id, previous.session.id) }))!
            .updatedAt,
        ).toEqual(previous.session.updatedAt);
      const sidebar = await new HomeRepository(db, userId).getSidebarAgentList();
      expect(sidebar.ungrouped[0].id).toBe(agentId);
      if (!previous)
        expect(
          await db.query.agentsToSessions.findMany({ where: eq(agentsToSessions.userId, userId) }),
        ).toEqual([]);
    },
  );

  it('reads unmigrated legacy history immediately and isolates new Agent bulk clears from Inbox', async () => {
    const { agent, session } = await legacy();
    const [oldTopic] = await db
      .insert(topics)
      .values({ userId, sessionId: session.id, title: 'Old' })
      .returning();
    await db.insert(messages).values({
      userId,
      sessionId: session.id,
      topicId: oldTopic.id,
      role: 'user',
      content: 'Old history',
    });
    const caller = callers();
    expect(
      (await caller.topic.getTopics({ agentId: session.id })).items.map((row) => row.id),
    ).toContain(oldTopic.id);
    expect(
      (await caller.message.getMessages({ agentId: session.id, topicId: oldTopic.id })).map(
        (row) => row.content,
      ),
    ).toContain('Old history');
    expect(
      (await caller.topic.searchTopics({ keywords: 'Old', sessionId: session.id })).map(
        (row) => row.id,
      ),
    ).toContain(oldTopic.id);
    const id = await caller.session.createSession({ type: 'agent', config: {}, session: {} });
    await caller.message.createMessage({ sessionId: id, role: 'user', content: 'New context' });
    await db.insert(messages).values({ userId, role: 'user', content: 'Inbox orphan' });
    await caller.message.removeMessagesByAssistant({ sessionId: id });
    expect(
      (await db.query.messages.findMany({ where: eq(messages.userId, userId) })).map(
        (row) => row.content,
      ),
    ).toEqual(expect.arrayContaining(['Inbox orphan', 'Old history']));
    expect(await db.query.messages.findMany({ where: eq(messages.agentId, id) })).toEqual([]);
    const newTopic = await caller.topic.createTopic({ sessionId: id, title: 'Clear me' });
    await caller.topic.batchDeleteBySessionId({ id });
    expect(await db.query.topics.findFirst({ where: eq(topics.id, newTopic) })).toMatchObject({
      isDeleted: true,
    });
    expect(await db.query.topics.findFirst({ where: eq(topics.id, oldTopic.id) })).toMatchObject({
      isDeleted: null,
    });
    expect(await resolveContext({ agentId: session.id }, db, userId)).toMatchObject({
      agentId: agent.id,
      sessionId: session.id,
    });
  });

  it('fails closed for foreign, trashed, group and multi-agent contexts', async () => {
    const { agent, session } = await legacy();
    const caller = callers();
    await expect(
      callers(undefined, otherUserId).agent.getAgentConfigById({ agentId: session.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const workspaceId = await workspace();
    await expect(
      callers(workspaceId).agent.getAgentConfigById({ agentId: agent.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [otherAgent] = await db.insert(agents).values({ userId }).returning();
    expect(
      await resolveContext({ agentId: otherAgent.id, sessionId: session.id }, db, userId),
    ).toMatchObject({ agentId: otherAgent.id, sessionId: null });
    await db
      .insert(agentsToSessions)
      .values({ agentId: otherAgent.id, sessionId: session.id, userId });
    await expect(caller.agent.getAgentConfigById({ agentId: session.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.session.updateSession({ id: session.id, value: {} })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
    await db.update(sessions).set({ type: 'group' }).where(eq(sessions.id, session.id));
    await db.delete(agentsToSessions).where(eq(agentsToSessions.agentId, otherAgent.id));
    await expect(resolveAgentReference(session.id, db, userId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await batchResolveAgentIdFromSessions([session.id, 'ssn_missing'], db, userId)).toEqual(
      new Map(),
    );
    await db.update(sessions).set({ type: 'agent' }).where(eq(sessions.id, session.id));
    await db.update(agents).set({ isDeleted: true }).where(eq(agents.id, agent.id));
    for (const id of [session.id, agent.id]) {
      await expect(caller.agent.getAgentConfigById({ agentId: id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(caller.session.updateSession({ id, value: {} })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it('keeps persisted nonstandard Agent ids usable without treating unknown ids as authorized', async () => {
    const [agent] = await db
      .insert(agents)
      .values({ id: `agent_imported_${userId}`, userId, title: 'Imported' })
      .returning();
    expect(await callers().agent.getAgentConfigById({ agentId: agent.id })).toMatchObject({
      id: agent.id,
    });
    await callers().agent.updateAgentConfig({ agentId: agent.id, value: { title: 'Renamed' } });
    expect(await db.query.agents.findFirst({ where: eq(agents.id, agent.id) })).toMatchObject({
      title: 'Renamed',
    });
    await expect(
      callers(undefined, otherUserId).agent.getAgentConfigById({ agentId: agent.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(resolveAgentReference('agent_missing', db, userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await db.update(agents).set({ isDeleted: true }).where(eq(agents.id, agent.id));
    await expect(callers().agent.getAgentConfigById({ agentId: agent.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each(['agent', 'session'] as const)(
    'clears delegated replies inside an authorized concrete topic through %s',
    async (context) => {
      const { agent: parent, session } = await legacy();
      const [callee] = await db.insert(agents).values({ userId }).returning();
      const [topic, otherTopic, visitorTopic] = await db
        .insert(topics)
        .values([
          { userId, agentId: parent.id },
          { userId, agentId: parent.id },
          { userId, agentId: parent.id, senderId: 'visitor' },
        ])
        .returning();
      const target = await db
        .insert(messages)
        .values([
          { userId, agentId: parent.id, topicId: topic.id, role: 'user', content: 'Parent turn' },
          {
            userId,
            agentId: callee.id,
            topicId: topic.id,
            role: 'assistant',
            content: 'Delegated reply',
          },
          {
            userId,
            sessionId: session.id,
            topicId: topic.id,
            role: 'user',
            content: 'Legacy turn',
          },
        ])
        .returning();
      const protectedRows = await db
        .insert(messages)
        .values([
          {
            userId,
            agentId: callee.id,
            topicId: otherTopic.id,
            role: 'assistant',
            content: 'Other topic',
          },
          { userId, agentId: callee.id, role: 'assistant', content: 'Default callee' },
          { userId: otherUserId, topicId: topic.id, role: 'user', content: 'Foreign' },
          {
            userId,
            agentId: parent.id,
            topicId: visitorTopic.id,
            role: 'assistant',
            content: 'Visitor',
          },
        ])
        .returning();
      const id = context === 'agent' ? parent.id : session.id;
      const input = { agentId: id, topicId: topic.id };
      expect((await callers().message.getMessages(input)).map((row) => row.id).sort()).toEqual(
        target.map((row) => row.id).sort(),
      );
      await callers().message.removeMessagesByAssistant(input);
      expect(await callers().message.getMessages(input)).toEqual([]);
      for (const row of target)
        expect(
          await db.query.messages.findFirst({ where: eq(messages.id, row.id) }),
        ).toBeUndefined();
      await expect(
        callers().message.removeMessagesByAssistant({ agentId: id, topicId: visitorTopic.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await callers().message.removeMessagesByAssistant({ agentId: id });
      for (const row of protectedRows)
        expect(await db.query.messages.findFirst({ where: eq(messages.id, row.id) })).toEqual(row);
    },
  );

  it.each(['inbox', 'ssn_inbox', 'agent', 'session'] as const)(
    'trashes unmigrated Inbox orphan topics through %s before background migration',
    async (context) => {
      const [inbox, other] = await db
        .insert(agents)
        .values([{ userId, slug: 'inbox' }, { userId }])
        .returning();
      let sessionId: string | undefined;
      if (context === 'session') {
        const [session] = await db
          .insert(sessions)
          .values({ userId, slug: 'inbox', type: 'agent' })
          .returning();
        sessionId = session.id;
        await db.insert(agentsToSessions).values({ userId, agentId: inbox.id, sessionId });
      }
      const workspaceId = await workspace();
      const targets = await db
        .insert(topics)
        .values([
          { userId, agentId: inbox.id },
          { userId },
          ...(sessionId ? [{ userId, sessionId }] : []),
        ])
        .returning();
      const protectedRows = await db
        .insert(topics)
        .values([
          { userId, agentId: other.id },
          { userId: otherUserId },
          { userId, workspaceId },
          { userId, senderId: 'visitor' },
          { userId, isDeleted: true },
        ])
        .returning();
      const [message] = await db
        .insert(messages)
        .values({ userId, topicId: targets[1].id, role: 'user', content: 'Keep until purge' })
        .returning();
      const id = context === 'agent' ? inbox.id : context === 'session' ? sessionId! : context;
      // No listing/migration is needed for an effective bulk delete.
      await callers().topic.batchDeleteBySessionId(context === 'agent' ? { agentId: id } : { id });
      for (const row of targets)
        expect(await db.query.topics.findFirst({ where: eq(topics.id, row.id) })).toMatchObject({
          isDeleted: true,
        });
      for (const row of protectedRows)
        expect(await db.query.topics.findFirst({ where: eq(topics.id, row.id) })).toEqual(row);
      expect(await db.query.messages.findFirst({ where: eq(messages.id, message.id) })).toEqual(
        message,
      );
      const registry = await db.query.trashItems.findMany({ where: eq(trashItems.userId, userId) });
      expect(registry.map((row) => row.resourceId).sort()).toEqual(
        targets.map((row) => row.id).sort(),
      );
    },
  );

  it('trashes unmigrated Session topics together with Agent topics without adopting another Agent', async () => {
    const { agent, session } = await legacy();
    const [other] = await db.insert(agents).values({ userId }).returning();
    const rows = await db
      .insert(topics)
      .values([
        { userId, sessionId: session.id, title: 'Unmigrated' },
        { userId, agentId: agent.id, title: 'Canonical' },
        { userId, agentId: other.id, sessionId: session.id, title: 'Another Agent' },
        { userId, title: 'Inbox' },
      ])
      .returning();
    await callers().topic.batchDeleteBySessionId({ id: session.id });
    const actual = await db.query.topics.findMany({ where: eq(topics.userId, userId) });
    expect(
      actual
        .filter((row) => row.isDeleted)
        .map((row) => row.id)
        .sort(),
    ).toEqual(
      rows
        .slice(0, 2)
        .map((row) => row.id)
        .sort(),
    );
  });

  it.each(['inbox', 'ssn_inbox', 'agent', 'session'] as const)(
    'lists all three Inbox topic shapes through %s without trusting the client flag',
    async (context) => {
      const { agent: inbox, session } = await legacy();
      await db.update(agents).set({ slug: 'inbox' }).where(eq(agents.id, inbox.id));
      await db.update(sessions).set({ slug: 'inbox' }).where(eq(sessions.id, session.id));
      const { agent: other } = await legacy();
      const workspaceId = await workspace();
      const visible = await db
        .insert(topics)
        .values([
          { userId, agentId: inbox.id, title: 'Current Inbox' },
          { userId, sessionId: session.id, title: 'Session Inbox' },
          { userId, title: 'Orphan Inbox' },
        ])
        .returning();
      const excluded = await db
        .insert(topics)
        .values([
          { userId, agentId: other.id, title: 'Other Agent' },
          { userId: otherUserId, title: 'Foreign orphan' },
          { userId, workspaceId, title: 'Workspace orphan' },
          { userId, isDeleted: true, title: 'Trashed orphan' },
        ])
        .returning();
      const caller = callers().topic;
      const id = context === 'agent' ? inbox.id : context === 'session' ? session.id : context;
      for (const isInbox of [undefined, false, true]) {
        vi.mocked(after).mockClear();
        const input = { sessionId: id, ...(isInbox === undefined ? {} : { isInbox }) };
        const result = await caller.getTopics(input);
        expect(result.total).toBe(3);
        expect(result.items.map((row) => row.id).sort()).toEqual(
          visible.map((row) => row.id).sort(),
        );
        // The immediate response must include history before deferred migration runs.
        expect(
          (await db.query.topics.findFirst({ where: eq(topics.id, visible[2].id) }))?.agentId,
        ).toBeNull();
      }
      vi.mocked(after).mockClear();
      await caller.getTopics({ sessionId: id });
      const migration = vi.mocked(after).mock.calls.at(-1)?.[0];
      if (typeof migration !== 'function') throw new Error('Missing deferred migration');
      await migration();
      expect(
        (await db.query.topics.findFirst({ where: eq(topics.id, visible[2].id) }))?.agentId,
      ).toBe(inbox.id);
      expect(
        (await db.query.topics.findFirst({ where: eq(topics.id, visible[1].id) }))?.agentId,
      ).toBe(inbox.id);
      const protectedRows = await db.query.topics.findMany({
        where: eq(topics.userId, otherUserId),
      });
      expect(protectedRows.map((row) => row.agentId)).toEqual([null]);
      expect(
        (await db.query.topics.findFirst({ where: eq(topics.id, excluded[2].id) }))?.agentId,
      ).toBeNull();
    },
  );

  it('lists and migrates orphan Inbox topics when no Session relationship exists', async () => {
    const [inbox] = await db.insert(agents).values({ userId, slug: 'inbox' }).returning();
    const [orphan] = await db
      .insert(topics)
      .values({ userId, title: 'Inbox without Session' })
      .returning();
    vi.mocked(after).mockClear();
    const result = await callers().topic.getTopics({ agentId: inbox.id, isInbox: false });
    expect(result.items.map((row) => row.id)).toEqual([orphan.id]);
    const migration = vi.mocked(after).mock.calls.at(-1)?.[0];
    if (typeof migration !== 'function') throw new Error('Missing deferred migration');
    await migration();
    expect((await db.query.topics.findFirst({ where: eq(topics.id, orphan.id) }))?.agentId).toBe(
      inbox.id,
    );
  });

  it('does not let a normal Agent adopt Inbox orphans with a forged isInbox flag', async () => {
    const { agent, session } = await legacy();
    await db.insert(agents).values({ userId, slug: 'inbox' });
    const [orphan] = await db.insert(topics).values({ userId, title: 'Inbox only' }).returning();
    const [own] = await db
      .insert(topics)
      .values({ userId, sessionId: session.id, title: 'Own' })
      .returning();
    vi.mocked(after).mockClear();
    const result = await callers().topic.getTopics({ agentId: agent.id, isInbox: true });
    expect(result.items.map((row) => row.id)).toEqual([own.id]);
    expect(result.total).toBe(1);
    const migration = vi.mocked(after).mock.calls.at(-1)?.[0];
    if (typeof migration !== 'function') throw new Error('Missing deferred migration');
    await migration();
    expect(
      (await db.query.topics.findFirst({ where: eq(topics.id, orphan.id) }))?.agentId,
    ).toBeNull();
  });

  it.each(['inbox', 'ssn_inbox', 'agent'] as const)(
    'reads and clears %s Inbox history without touching standalone or foreign messages',
    async (context) => {
      const [inbox] = await db.insert(agents).values({ userId, slug: 'inbox' }).returning();
      const [other] = await db.insert(agents).values({ userId }).returning();
      await db.insert(messages).values([
        { userId, role: 'user', content: 'Orphan Inbox' },
        { userId, agentId: inbox.id, role: 'user', content: 'Current Inbox' },
        { userId, agentId: other.id, role: 'user', content: 'Standalone' },
        { userId: otherUserId, role: 'user', content: 'Foreign Inbox' },
      ]);
      const id = context === 'agent' ? inbox.id : context;
      expect(
        (await callers().message.getMessages({ sessionId: id })).map((row) => row.content).sort(),
      ).toEqual(['Current Inbox', 'Orphan Inbox']);
      expect(
        (await callers().message.getMessages({ agentId: other.id })).map((row) => row.content),
      ).toEqual(['Standalone']);
      await callers().message.removeMessagesByAssistant({ sessionId: id });
      expect(await callers().message.getMessages({ sessionId: id })).toEqual([]);
      expect(
        (await db.query.messages.findMany({ where: eq(messages.userId, userId) })).map(
          (row) => row.content,
        ),
      ).toEqual(['Standalone']);
      expect(
        (await db.query.messages.findMany({ where: eq(messages.userId, otherUserId) })).map(
          (row) => row.content,
        ),
      ).toEqual(['Foreign Inbox']);
    },
  );

  it.each(['inbox', 'ssn_inbox', 'agent', 'session'] as const)(
    'clears %s Inbox topic history while checking the parent topic',
    async (context) => {
      const { agent: inbox, session } = await legacy();
      await db.update(agents).set({ slug: 'inbox' }).where(eq(agents.id, inbox.id));
      await db.update(sessions).set({ slug: 'inbox' }).where(eq(sessions.id, session.id));
      const [other] = await db.insert(agents).values({ userId }).returning();
      const [otherTopic] = await db
        .insert(topics)
        .values({ userId, agentId: other.id })
        .returning();
      const guards = await db
        .insert(messages)
        .values([
          { userId, role: 'user', content: 'Default Inbox' },
          { userId, topicId: otherTopic.id, role: 'user', content: 'Other Agent topic' },
        ])
        .returning();
      const id = context === 'agent' ? inbox.id : context === 'session' ? session.id : context;
      const caller = callers();
      for (const parent of ['unassigned', 'agent', 'session'] as const) {
        const [topic] = await db
          .insert(topics)
          .values({
            userId,
            agentId: parent === 'agent' ? inbox.id : null,
            sessionId: parent === 'session' ? session.id : null,
          })
          .returning();
        const targets = await db
          .insert(messages)
          .values([
            { userId, topicId: topic.id, role: 'user', content: 'Orphan topic history' },
            {
              userId,
              agentId: inbox.id,
              topicId: topic.id,
              role: 'user',
              content: 'Current topic',
            },
          ])
          .returning();
        const [foreign] = await db
          .insert(messages)
          .values({
            userId: otherUserId,
            topicId: topic.id,
            role: 'user',
            content: 'Foreign topic history',
          })
          .returning();
        expect(
          (await caller.message.getMessages({ sessionId: id, topicId: topic.id }))
            .map((row) => row.id)
            .sort(),
        ).toEqual(targets.map((row) => row.id).sort());
        await db.update(topics).set({ isDeleted: true }).where(eq(topics.id, topic.id));
        await caller.message.removeMessagesByAssistant({ sessionId: id, topicId: topic.id });
        for (const target of targets) {
          expect(await db.query.messages.findFirst({ where: eq(messages.id, target.id) })).toEqual(
            target,
          );
        }
        await db.update(topics).set({ isDeleted: null }).where(eq(topics.id, topic.id));
        await caller.message.removeMessagesByAssistant({ sessionId: id, topicId: topic.id });
        expect(await caller.message.getMessages({ sessionId: id, topicId: topic.id })).toEqual([]);
        expect(await db.query.messages.findFirst({ where: eq(messages.id, foreign.id) })).toEqual(
          foreign,
        );
      }
      for (const guard of guards) {
        expect(await db.query.messages.findFirst({ where: eq(messages.id, guard.id) })).toEqual(
          guard,
        );
      }
    },
  );

  it('passes the canonical id to config redaction and denies use-only operations at view access', async () => {
    const workspaceId = await workspace();
    const { agent, session } = await legacy(workspaceId);
    await db
      .update(agents)
      .set({ systemRole: 'Owner secret', title: 'Profile' })
      .where(eq(agents.id, agent.id));
    await new ResourcePermissionModel(db, workspaceId).setAccessLevel(
      'agent',
      agent.id,
      'view',
      userId,
    );
    const [topic] = await db
      .insert(topics)
      .values({ userId, workspaceId, agentId: agent.id })
      .returning();
    const [allowed] = await db
      .insert(agents)
      .values({ userId: otherUserId, workspaceId })
      .returning();
    const member = callers(workspaceId, otherUserId);
    await expect(
      member.message.removeMessagesByAssistant({ agentId: allowed.id, topicId: topic.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const config = await member.agent.getAgentConfigById({ agentId: session.id });
    expect(config).toMatchObject({ id: agent.id, title: 'Profile' });
    expect(config).not.toHaveProperty('systemRole');
    await expect(
      member.agent.updateAgentConfig({ agentId: session.id, value: { title: 'Stolen' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(member.session.updateSession({ id: session.id, value: {} })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await expect(
      member.message.createMessage({ sessionId: session.id, role: 'user', content: 'Forbidden' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await db.query.messages.findMany({
        where: and(eq(messages.agentId, agent.id), eq(messages.userId, otherUserId)),
      }),
    ).toEqual([]);
  });

  it('never reprovisions a trashed or private Inbox through the legacy config fallback', async () => {
    const workspaceId = await workspace();
    const { agent, session } = await legacy(workspaceId);
    await db.update(sessions).set({ slug: 'inbox' }).where(eq(sessions.id, session.id));
    await db.update(agents).set({ visibility: 'private' }).where(eq(agents.id, agent.id));
    await expect(
      callers(workspaceId, otherUserId).agent.getAgentConfig({ sessionId: 'inbox' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db.update(agents).set({ isDeleted: true }).where(eq(agents.id, agent.id));
    await expect(
      callers(workspaceId).agent.getAgentConfig({ sessionId: 'inbox' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await db.query.agents.findMany({ where: eq(agents.workspaceId, workspaceId) }),
    ).toHaveLength(1);
    expect(await db.query.agents.findFirst({ where: eq(agents.id, agent.id) })).toMatchObject({
      isDeleted: true,
    });
  });

  it('resolves explicit Inbox aliases without creating Session rows and rejects metadata writes through touch', async () => {
    const [inbox] = await db.insert(agents).values({ userId, slug: 'inbox' }).returning();
    for (const id of ['inbox', 'ssn_inbox'])
      expect(await resolveAgentReference(id, db, userId)).toEqual({
        agentId: inbox.id,
        sessionId: null,
      });
    expect(await callers().agent.getAgentConfig({ sessionId: 'inbox' })).toMatchObject({
      id: inbox.id,
    });
    await expect(
      callers().session.updateSession({ id: inbox.id, value: { pinned: true } as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await db.query.sessions.findMany({ where: eq(sessions.userId, userId) })).toEqual([]);
  });
});
