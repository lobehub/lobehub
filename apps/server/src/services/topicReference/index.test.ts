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

  it('does not expand personal-mode reads into workspaces', async () => {
    expect(await personalService.getTopicContext({ topicId: 'reference-current' })).toEqual({
      content: 'Topic not found: reference-current',
      success: false,
    });
  });
});
