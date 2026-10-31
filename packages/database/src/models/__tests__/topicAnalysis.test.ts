// @vitest-environment node
import type { TopicAnalysisResult } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, topicAnalyses, topics, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TopicAnalysisModel } from '../topicAnalysis';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-analysis-user';
const otherUserId = 'topic-analysis-user-2';
const workspaceId = 'topic-analysis-ws';
const topicId = 'tpc_analysis_1';
const workspaceTopicId = 'tpc_analysis_ws';

const personalModel = new TopicAnalysisModel(serverDB, userId);
const workspaceModel = new TopicAnalysisModel(serverDB, userId, workspaceId);

const result = (overrides: Partial<TopicAnalysisResult> = {}): TopicAnalysisResult => ({
  category: 'coding',
  intent: 'doing',
  labels: { collaboration: 'directive' },
  model: 'model-a',
  outcome: 'success',
  provider: 'provider-a',
  taxonomyVersion: 'v1',
  ...overrides,
});

const snapshot = { lastMessageId: 'msg_1', lastMessageUpdatedAt: new Date('2026-10-30T10:00:00Z') };

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: workspaceId, name: 'Test WS', primaryOwnerId: userId, slug: 'analysis-ws' }]);
  await serverDB.insert(topics).values([
    { id: topicId, userId },
    { id: workspaceTopicId, userId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(messages);
  await serverDB.delete(topicAnalyses);
  await serverDB.delete(topics);
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
});

describe('TopicAnalysisModel', () => {
  it('saves an analysis with its message snapshot', async () => {
    await personalModel.save({ ...snapshot, result: result(), topicId });

    const row = await personalModel.findByTopic(topicId, 'v1');
    expect(row).toMatchObject({
      category: 'coding',
      intent: 'doing',
      labels: { collaboration: 'directive' },
      lastMessageId: 'msg_1',
      model: 'model-a',
      outcome: 'success',
      provider: 'provider-a',
      secondaryCategory: null,
      userId,
      workspaceId: null,
    });
    expect(row?.lastMessageUpdatedAt?.toISOString()).toBe('2026-10-30T10:00:00.000Z');
  });

  it('replaces the analysis for the same taxonomy version instead of duplicating it', async () => {
    await personalModel.save({ ...snapshot, result: result(), topicId });
    await personalModel.save({
      lastMessageId: 'msg_2',
      lastMessageUpdatedAt: new Date('2026-10-30T11:00:00Z'),
      result: result({ category: 'research', intent: 'asking', outcome: null }),
      topicId,
    });

    const rows = await serverDB.select().from(topicAnalyses);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: 'research',
      intent: 'asking',
      lastMessageId: 'msg_2',
      outcome: null,
    });
  });

  it('never lets an analysis of older messages replace a newer one', async () => {
    await personalModel.save({
      lastMessageId: 'msg_2',
      lastMessageUpdatedAt: new Date('2026-10-30T11:00:00Z'),
      result: result({ category: 'research' }),
      topicId,
    });

    const stale = await personalModel.save({ ...snapshot, result: result(), topicId });

    expect(stale).toBeUndefined();
    expect(await personalModel.findByTopic(topicId, 'v1')).toMatchObject({
      category: 'research',
      lastMessageId: 'msg_2',
    });
  });

  it('keeps one row per taxonomy version', async () => {
    await personalModel.save({ ...snapshot, result: result(), topicId });
    await personalModel.save({ ...snapshot, result: result({ taxonomyVersion: 'v2' }), topicId });

    expect(await serverDB.select().from(topicAnalyses)).toHaveLength(2);
    expect((await personalModel.findByTopic(topicId, 'v2'))?.taxonomyVersion).toBe('v2');
  });

  it('scopes reads to the owner and workspace', async () => {
    await workspaceModel.save({ ...snapshot, result: result(), topicId: workspaceTopicId });

    expect((await workspaceModel.findByTopic(workspaceTopicId, 'v1'))?.workspaceId).toBe(
      workspaceId,
    );
    expect(await personalModel.findByTopic(workspaceTopicId, 'v1')).toBeUndefined();
    expect(
      await new TopicAnalysisModel(serverDB, otherUserId, workspaceId).findByTopic(
        workspaceTopicId,
        'v1',
      ),
    ).toBeUndefined();
  });

  it('is removed together with its topic', async () => {
    await personalModel.save({ ...snapshot, result: result(), topicId });
    await serverDB.delete(topics);

    expect(await serverDB.select().from(topicAnalyses)).toHaveLength(0);
  });

  describe('topic usage snapshot', () => {
    it('reads the topic totals and counts live messages by role', async () => {
      await serverDB
        .update(topics)
        .set({
          model: 'gpt-x',
          provider: 'openai',
          totalCost: 0.0123,
          totalInputTokens: 900,
          totalOutputTokens: 100,
          totalTokens: 1000,
          usage: { llm: { apiCalls: 3 } },
        })
        .where(eq(topics.id, topicId));
      await serverDB.insert(messages).values([
        { content: 'q1', role: 'user', topicId, userId },
        { content: 'a1', role: 'assistant', topicId, userId },
        { content: 'run', role: 'tool', topicId, userId },
        { content: 'run', role: 'tool', topicId, userId },
        { content: 'q2', role: 'user', topicId, userId },
        { content: 'trashed', isDeleted: true, role: 'user', topicId, userId },
      ]);

      expect(await personalModel.snapshotTopicUsage(topicId)).toEqual({
        assistantMessages: 1,
        llmCalls: 3,
        toolCalls: 2,
        topicModel: 'gpt-x',
        topicProvider: 'openai',
        totalCost: 0.0123,
        totalInputTokens: 900,
        totalOutputTokens: 100,
        totalTokens: 1000,
        userMessages: 2,
      });
    });

    it('keeps unmeasured totals null instead of zero', async () => {
      expect(await personalModel.snapshotTopicUsage(topicId)).toMatchObject({
        assistantMessages: 0,
        llmCalls: null,
        totalCost: null,
        totalTokens: null,
        userMessages: 0,
      });
    });

    it('stores the snapshot with the analysis', async () => {
      const usage = {
        assistantMessages: 4,
        llmCalls: 5,
        toolCalls: 6,
        topicModel: 'gpt-x',
        topicProvider: 'openai',
        totalCost: 1.5,
        totalInputTokens: 70,
        totalOutputTokens: 30,
        totalTokens: 100,
        userMessages: 3,
      };

      await personalModel.save({ ...snapshot, result: result(), topicId, usage });

      expect(await personalModel.findByTopic(topicId, 'v1')).toMatchObject(usage);
    });
  });
});
