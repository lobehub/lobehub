import { agents, messages, topics, users, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TopicReferenceService } from './index';

const db = await getTestDB();
const userId = 'topic-reference-owner';
const otherUserId = 'topic-reference-other';
const workspaceId = 'topic-reference-workspace';
const otherWorkspaceId = 'topic-reference-other-workspace';

describe('TopicReferenceService scope resolution', () => {
  beforeAll(async () => {
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(workspaces).values(
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: id,
        primaryOwnerId: userId,
        slug: id,
      })),
    );
    await db.insert(agents).values({ id: 'reference-personal-agent', userId });
    await db.insert(topics).values([
      { id: 'reference-personal-summary', userId, historySummary: 'Personal summary' },
      {
        agentId: 'reference-personal-agent',
        id: 'reference-personal-messages',
        userId,
      },
      { id: 'reference-current', userId, workspaceId },
      { id: 'reference-other-user', userId: otherUserId, historySummary: 'Foreign secret' },
      {
        id: 'reference-other-workspace',
        userId,
        workspaceId: otherWorkspaceId,
        historySummary: 'Other workspace secret',
      },
      { id: 'reference-visitor', userId, senderId: 'visitor', historySummary: 'Visitor secret' },
      {
        id: 'reference-workspace-visitor',
        userId,
        workspaceId,
        senderId: 'visitor',
        historySummary: 'Workspace visitor secret',
      },
    ]);
    await db.insert(messages).values([
      {
        agentId: 'reference-personal-agent',
        content: 'Personal pitch notes',
        id: 'reference-personal-message',
        role: 'user',
        topicId: 'reference-personal-messages',
        userId,
      },
      {
        content: 'Workspace notes',
        id: 'reference-workspace-message',
        role: 'user',
        topicId: 'reference-current',
        userId,
        workspaceId,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  });

  const workspaceService = new TopicReferenceService(db, userId, workspaceId);
  const personalService = new TopicReferenceService(db, userId);

  it('reads the caller’s personal summary from a workspace', async () => {
    const result = await workspaceService.getTopicContext({
      topicId: 'reference-personal-summary',
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('Personal summary');
  });

  it('reads personal messages using the target scope and agent', async () => {
    const result = await workspaceService.getTopicContext({
      topicId: 'reference-personal-messages',
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('Personal pitch notes');
    expect(result.content).not.toContain('Workspace notes');
  });

  it('continues to read current workspace messages', async () => {
    const result = await workspaceService.getTopicContext({ topicId: 'reference-current' });
    expect(result.success).toBe(true);
    expect(result.content).toContain('Workspace notes');
  });

  it('continues to read personal topics in personal mode', async () => {
    const result = await personalService.getTopicContext({
      topicId: 'reference-personal-messages',
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('Personal pitch notes');
  });

  it.each([
    'reference-other-user',
    'reference-other-workspace',
    'reference-visitor',
    'reference-workspace-visitor',
    'missing',
  ])('does not expose inaccessible topic %s', async (topicId) => {
    expect(await workspaceService.getTopicContext({ topicId })).toEqual({
      content: `Topic not found: ${topicId}`,
      success: false,
    });
  });

  describe('findTopic', () => {
    it('falls back to the caller’s personal topic from a workspace', async () => {
      expect(await workspaceService.findTopic('reference-personal-messages')).toMatchObject({
        id: 'reference-personal-messages',
        workspaceId: null,
      });
    });

    it('prefers the current workspace', async () => {
      expect(await workspaceService.findTopic('reference-current')).toMatchObject({
        id: 'reference-current',
        workspaceId,
      });
    });

    it.each(['reference-other-user', 'reference-other-workspace', 'reference-visitor', 'missing'])(
      'does not resolve inaccessible topic %s',
      async (topicId) => {
        expect(await workspaceService.findTopic(topicId)).toBeUndefined();
      },
    );

    it('does not reach a workspace from personal mode', async () => {
      expect(await personalService.findTopic('reference-current')).toBeUndefined();
    });
  });

  it('does not expand personal-mode reads into workspaces', async () => {
    expect(await personalService.getTopicContext({ topicId: 'reference-current' })).toEqual({
      content: 'Topic not found: reference-current',
      success: false,
    });
  });
});

describe('TopicReferenceService.isNamedInConversation', () => {
  const ownerId = 'topic-named-owner';
  const scopeId = 'topic-named-workspace';
  const conversation = 'tpc_namedConvo01';

  beforeAll(async () => {
    await db.insert(users).values({ id: ownerId });
    await db.insert(workspaces).values({
      id: scopeId,
      name: scopeId,
      primaryOwnerId: ownerId,
      slug: scopeId,
    });
    await db.insert(topics).values([
      { id: conversation, userId: ownerId, workspaceId: scopeId },
      { id: 'tpc_namedElsewhere', userId: ownerId, workspaceId: scopeId },
    ]);
    const say = (id: string, content: string, role = 'user', topicId = conversation) => ({
      content,
      id,
      role,
      topicId,
      userId: ownerId,
      workspaceId: scopeId,
    });
    await db
      .insert(messages)
      .values([
        say('named-bare', '参考这个对话，tpc_bareRef0001，clone 3 个项目到当前目录'),
        say('named-tag', '<refer_topic name="Earlier" id="tpc_tagRef00001" />\nSummarize it'),
        say('named-escaped', String.raw`\<refer\_topic name="Earlier" id="tpc\_escRef00001" />`),
        say('named-longer', 'see tpc_prefixRef0001extra'),
        say('named-assistant', 'I could also read tpc_assistRef001', 'assistant'),
        say('named-other-topic', 'tpc_otherConvo01', 'user', 'tpc_namedElsewhere'),
      ]);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.id, [ownerId]));
  });

  const service = new TopicReferenceService(db, ownerId, scopeId);

  it.each([
    ['the conversation itself', conversation],
    ['a bare id the user wrote', 'tpc_bareRef0001'],
    ['a <refer_topic> tag', 'tpc_tagRef00001'],
    ['a markdown-escaped <refer_topic> tag', 'tpc_escRef00001'],
  ])('reaches %s', async (_label, topicId) => {
    await expect(service.isNamedInConversation(conversation, topicId)).resolves.toBe(true);
  });

  it.each([
    ['an id that only starts a longer one', 'tpc_prefixRef0001'],
    ['an id only the assistant mentioned', 'tpc_assistRef001'],
    ['an id named in another conversation', 'tpc_otherConvo01'],
    ['a pattern rather than an id', 'tpc_.*'],
  ])('does not reach %s', async (_label, topicId) => {
    await expect(service.isNamedInConversation(conversation, topicId)).resolves.toBe(false);
  });

  it("does not read another scope's conversation", async () => {
    const outsider = new TopicReferenceService(db, ownerId);

    await expect(outsider.isNamedInConversation(conversation, 'tpc_bareRef0001')).resolves.toBe(
      false,
    );
  });
});
