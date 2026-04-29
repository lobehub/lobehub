// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, chatGroups, documents, knowledgeBases, tasks, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { RecentModel } from '../recent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'recent-model-test-user';
const otherUserId = 'recent-model-test-other-user';

const recentModel = new RecentModel(serverDB, userId);

const now = () => new Date();
const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000);

const baseDocFields = {
  fileType: 'markdown',
  source: 'document',
  totalCharCount: 100,
  totalLineCount: 5,
} as const;

const baseTaskFields = {
  instruction: 'do the thing',
  seq: 1,
} as const;

describe('RecentModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('queryRecent', () => {
    it('returns empty array when user has no recent items', async () => {
      const result = await recentModel.queryRecent();
      expect(result).toEqual([]);
    });

    it('only returns rows for the calling user', async () => {
      await serverDB.insert(agents).values({ id: 'agent-mine', userId, slug: 'inbox' });
      await serverDB
        .insert(agents)
        .values({ id: 'agent-other', userId: otherUserId, slug: 'inbox' });

      await serverDB.insert(topics).values([
        { id: 'topic-mine', userId, agentId: 'agent-mine', title: 'mine', updatedAt: now() },
        {
          id: 'topic-other',
          userId: otherUserId,
          agentId: 'agent-other',
          title: 'other',
          updatedAt: now(),
        },
      ]);

      const result = await recentModel.queryRecent();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'topic-mine', type: 'topic' });
    });

    describe('topics arm', () => {
      it('includes inbox-agent topics and group topics', async () => {
        await serverDB.insert(agents).values({ id: 'agent-inbox', userId, slug: 'inbox' });
        await serverDB.insert(chatGroups).values({ id: 'group-1', userId });

        await serverDB.insert(topics).values([
          {
            id: 'topic-inbox',
            userId,
            agentId: 'agent-inbox',
            title: 'inbox topic',
            updatedAt: minutesAgo(5),
          },
          {
            id: 'topic-group',
            userId,
            groupId: 'group-1',
            title: 'group topic',
            updatedAt: minutesAgo(2),
          },
        ]);

        const result = await recentModel.queryRecent();
        expect(result.map((r) => r.id)).toEqual(['topic-group', 'topic-inbox']);
        expect(result[0]).toMatchObject({
          id: 'topic-group',
          type: 'topic',
          routeId: null,
          routeGroupId: 'group-1',
        });
        expect(result[1]).toMatchObject({
          id: 'topic-inbox',
          type: 'topic',
          routeId: 'agent-inbox',
          routeGroupId: null,
        });
      });

      it('includes topics on non-virtual non-group agents', async () => {
        await serverDB.insert(agents).values({ id: 'agent-real', userId, virtual: false });

        await serverDB.insert(topics).values({
          id: 'topic-real',
          userId,
          agentId: 'agent-real',
          title: 'real',
          updatedAt: now(),
        });

        const result = await recentModel.queryRecent();
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('topic-real');
      });

      it('excludes topics on virtual agents that are not in a group', async () => {
        await serverDB.insert(agents).values({ id: 'agent-virtual', userId, virtual: true });

        await serverDB.insert(topics).values({
          id: 'topic-virtual',
          userId,
          agentId: 'agent-virtual',
          title: 'virtual',
          updatedAt: now(),
        });

        const result = await recentModel.queryRecent();
        expect(result).toEqual([]);
      });

      it('excludes topics with system triggers', async () => {
        await serverDB.insert(agents).values({ id: 'agent-inbox', userId, slug: 'inbox' });

        await serverDB.insert(topics).values([
          { id: 'topic-cron', userId, agentId: 'agent-inbox', trigger: 'cron', updatedAt: now() },
          { id: 'topic-eval', userId, agentId: 'agent-inbox', trigger: 'eval', updatedAt: now() },
          {
            id: 'topic-task',
            userId,
            agentId: 'agent-inbox',
            trigger: 'task_manager',
            updatedAt: now(),
          },
          {
            id: 'topic-task2',
            userId,
            agentId: 'agent-inbox',
            trigger: 'task',
            updatedAt: now(),
          },
          {
            id: 'topic-chat',
            userId,
            agentId: 'agent-inbox',
            trigger: 'chat',
            updatedAt: now(),
          },
        ]);

        const result = await recentModel.queryRecent();
        expect(result.map((r) => r.id)).toEqual(['topic-chat']);
      });

      it('falls back to "Untitled Topic" when title is null', async () => {
        await serverDB.insert(agents).values({ id: 'agent-inbox', userId, slug: 'inbox' });
        await serverDB.insert(topics).values({
          id: 'topic-untitled',
          userId,
          agentId: 'agent-inbox',
          title: null,
          updatedAt: now(),
        });

        const result = await recentModel.queryRecent();
        expect(result[0].title).toBe('Untitled Topic');
      });

      it('returns topic metadata when present', async () => {
        await serverDB.insert(agents).values({ id: 'agent-inbox', userId, slug: 'inbox' });
        await serverDB.insert(topics).values({
          id: 'topic-with-meta',
          userId,
          agentId: 'agent-inbox',
          metadata: { bot: { platform: 'slack' } } as any,
          updatedAt: now(),
        });

        const result = await recentModel.queryRecent();
        expect(result[0].metadata).toEqual({ bot: { platform: 'slack' } });
      });
    });

    describe('documents arm', () => {
      it('includes user-authored "api" pages', async () => {
        await serverDB.insert(documents).values({
          id: 'doc-api',
          userId,
          title: 'My Page',
          sourceType: 'api',
          updatedAt: now(),
          ...baseDocFields,
        });

        const result = await recentModel.queryRecent();
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          id: 'doc-api',
          type: 'document',
          title: 'My Page',
          routeId: null,
          routeGroupId: null,
          metadata: undefined,
        });
      });

      it('excludes web-browsing scraped pages (sourceType "web")', async () => {
        await serverDB.insert(documents).values([
          {
            id: 'doc-api',
            userId,
            title: 'Real Page',
            sourceType: 'api',
            updatedAt: minutesAgo(1),
            ...baseDocFields,
          },
          {
            id: 'doc-web',
            userId,
            title: 'XAU USD | Gold Spot US Dollar',
            sourceType: 'web',
            updatedAt: now(),
            ...baseDocFields,
          },
        ]);

        const result = await recentModel.queryRecent();
        expect(result.map((r) => r.id)).toEqual(['doc-api']);
      });

      it('excludes file uploads (sourceType "file")', async () => {
        await serverDB.insert(documents).values({
          id: 'doc-file',
          userId,
          sourceType: 'file',
          updatedAt: now(),
          ...baseDocFields,
        });

        const result = await recentModel.queryRecent();
        expect(result).toEqual([]);
      });

      it('excludes documents inside a knowledge base', async () => {
        await serverDB.insert(knowledgeBases).values({ id: 'kb-1', userId, name: 'kb' });
        await serverDB.insert(documents).values({
          id: 'doc-kb',
          userId,
          title: 'kb doc',
          sourceType: 'api',
          knowledgeBaseId: 'kb-1',
          updatedAt: now(),
          ...baseDocFields,
        });

        const result = await recentModel.queryRecent();
        expect(result).toEqual([]);
      });

      it('excludes folder documents', async () => {
        await serverDB.insert(documents).values({
          id: 'doc-folder',
          userId,
          title: 'Folder',
          sourceType: 'api',
          updatedAt: now(),
          ...baseDocFields,
          fileType: 'custom/folder',
        });

        const result = await recentModel.queryRecent();
        expect(result).toEqual([]);
      });

      it('falls back to filename then "Untitled Document" when title is null', async () => {
        await serverDB.insert(documents).values([
          {
            id: 'doc-fallback-filename',
            userId,
            title: null,
            filename: 'notes.md',
            sourceType: 'api',
            updatedAt: minutesAgo(1),
            ...baseDocFields,
          },
          {
            id: 'doc-untitled',
            userId,
            title: null,
            filename: null,
            sourceType: 'api',
            updatedAt: now(),
            ...baseDocFields,
          },
        ]);

        const result = await recentModel.queryRecent();
        const byId = Object.fromEntries(result.map((r) => [r.id, r.title]));
        expect(byId['doc-fallback-filename']).toBe('notes.md');
        expect(byId['doc-untitled']).toBe('Untitled Document');
      });
    });

    describe('tasks arm', () => {
      it('includes active tasks and surfaces assigneeAgentId as routeId', async () => {
        await serverDB.insert(agents).values({ id: 'agent-assignee', userId });

        await serverDB.insert(tasks).values({
          id: 'task-active',
          createdByUserId: userId,
          assigneeAgentId: 'agent-assignee',
          identifier: 'T-1',
          name: 'Active Task',
          status: 'running',
          updatedAt: now(),
          ...baseTaskFields,
        });

        const result = await recentModel.queryRecent();
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          id: 'task-active',
          type: 'task',
          title: 'Active Task',
          routeId: 'agent-assignee',
          routeGroupId: null,
        });
      });

      it('excludes completed and canceled tasks', async () => {
        await serverDB.insert(tasks).values([
          {
            id: 'task-done',
            createdByUserId: userId,
            identifier: 'T-2',
            status: 'completed',
            updatedAt: now(),
            ...baseTaskFields,
          },
          {
            id: 'task-canceled',
            createdByUserId: userId,
            identifier: 'T-3',
            status: 'canceled',
            updatedAt: now(),
            ...baseTaskFields,
          },
          {
            id: 'task-running',
            createdByUserId: userId,
            identifier: 'T-4',
            status: 'running',
            updatedAt: now(),
            ...baseTaskFields,
          },
        ]);

        const result = await recentModel.queryRecent();
        expect(result.map((r) => r.id)).toEqual(['task-running']);
      });

      it('falls back from name → instruction → "Untitled Task"', async () => {
        await serverDB.insert(tasks).values([
          {
            id: 'task-named',
            createdByUserId: userId,
            identifier: 'T-A',
            name: 'Named',
            instruction: 'do A',
            seq: 1,
            status: 'running',
            updatedAt: minutesAgo(2),
          },
          {
            id: 'task-instruction',
            createdByUserId: userId,
            identifier: 'T-B',
            name: null,
            instruction: 'fallback to instruction',
            seq: 2,
            status: 'running',
            updatedAt: minutesAgo(1),
          },
        ]);

        const result = await recentModel.queryRecent();
        const byId = Object.fromEntries(result.map((r) => [r.id, r.title]));
        expect(byId['task-named']).toBe('Named');
        expect(byId['task-instruction']).toBe('fallback to instruction');
      });
    });

    describe('combined results', () => {
      it('orders all three types by updatedAt desc and applies the limit', async () => {
        await serverDB.insert(agents).values({ id: 'agent-inbox', userId, slug: 'inbox' });

        await serverDB.insert(topics).values({
          id: 'topic-1',
          userId,
          agentId: 'agent-inbox',
          title: 'topic',
          updatedAt: minutesAgo(10),
        });
        await serverDB.insert(documents).values({
          id: 'doc-1',
          userId,
          title: 'doc',
          sourceType: 'api',
          updatedAt: minutesAgo(5),
          ...baseDocFields,
        });
        await serverDB.insert(tasks).values({
          id: 'task-1',
          createdByUserId: userId,
          identifier: 'T-1',
          name: 'task',
          status: 'running',
          updatedAt: minutesAgo(1),
          ...baseTaskFields,
        });

        const result = await recentModel.queryRecent(10);
        expect(result.map((r) => `${r.type}:${r.id}`)).toEqual([
          'task:task-1',
          'document:doc-1',
          'topic:topic-1',
        ]);
      });

      it('respects the limit parameter', async () => {
        await serverDB.insert(agents).values({ id: 'agent-inbox', userId, slug: 'inbox' });
        await serverDB.insert(topics).values(
          Array.from({ length: 5 }, (_, i) => ({
            id: `topic-${i}`,
            userId,
            agentId: 'agent-inbox',
            title: `t${i}`,
            updatedAt: minutesAgo(i),
          })),
        );

        const result = await recentModel.queryRecent(2);
        expect(result).toHaveLength(2);
        expect(result.map((r) => r.id)).toEqual(['topic-0', 'topic-1']);
      });

      it('returns Date objects for updatedAt', async () => {
        await serverDB.insert(agents).values({ id: 'agent-inbox', userId, slug: 'inbox' });
        await serverDB.insert(topics).values({
          id: 'topic-date',
          userId,
          agentId: 'agent-inbox',
          updatedAt: now(),
        });

        const [row] = await recentModel.queryRecent();
        expect(row.updatedAt).toBeInstanceOf(Date);
      });
    });
  });
});
