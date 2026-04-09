import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { taskService } from '@/services/task';

// Mock lambdaClient
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    brief: {
      markRead: { mutate: vi.fn() },
      resolve: { mutate: vi.fn() },
    },
    task: {
      addComment: { mutate: vi.fn() },
      addDependency: { mutate: vi.fn() },
      cancelTopic: { mutate: vi.fn() },
      clearAll: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      deleteTopic: { mutate: vi.fn() },
      detail: { query: vi.fn() },
      find: { query: vi.fn() },
      getDependencies: { query: vi.fn() },
      getCheckpoint: { query: vi.fn() },
      getPinnedDocuments: { query: vi.fn() },
      getReview: { query: vi.fn() },
      getSubtasks: { query: vi.fn() },
      getTaskTree: { query: vi.fn() },
      getTopics: { query: vi.fn() },
      groupList: { query: vi.fn() },
      list: { query: vi.fn() },
      pinDocument: { mutate: vi.fn() },
      removeDependency: { mutate: vi.fn() },
      reorderSubtasks: { mutate: vi.fn() },
      run: { mutate: vi.fn() },
      runReview: { mutate: vi.fn() },
      unpinDocument: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
      updateCheckpoint: { mutate: vi.fn() },
      updateConfig: { mutate: vi.fn() },
      updateReview: { mutate: vi.fn() },
      updateStatus: { mutate: vi.fn() },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TaskService', () => {
  describe('queries', () => {
    it('find should call task.find.query', async () => {
      await taskService.find('T-1');
      expect(lambdaClient.task.find.query).toHaveBeenCalledWith({ id: 'T-1' });
    });

    it('getDetail should call task.detail.query', async () => {
      await taskService.getDetail('T-1');
      expect(lambdaClient.task.detail.query).toHaveBeenCalledWith({ id: 'T-1' });
    });

    it('list should call task.list.query with params', async () => {
      const params = { assigneeAgentId: 'agt_1', limit: 50, offset: 0 };
      await taskService.list(params);
      expect(lambdaClient.task.list.query).toHaveBeenCalledWith(params);
    });

    it('getSubtasks should call task.getSubtasks.query', async () => {
      await taskService.getSubtasks('T-1');
      expect(lambdaClient.task.getSubtasks.query).toHaveBeenCalledWith({ id: 'T-1' });
    });

    it('getTaskTree should call task.getTaskTree.query', async () => {
      await taskService.getTaskTree('T-1');
      expect(lambdaClient.task.getTaskTree.query).toHaveBeenCalledWith({ id: 'T-1' });
    });
  });

  describe('mutations', () => {
    it('create should call task.create.mutate', async () => {
      const params = { instruction: 'Do something', name: 'Test' };
      await taskService.create(params);
      expect(lambdaClient.task.create.mutate).toHaveBeenCalledWith(params);
    });

    it('update should merge id with data', async () => {
      await taskService.update('T-1', { name: 'Updated', priority: 1 });
      expect(lambdaClient.task.update.mutate).toHaveBeenCalledWith({
        id: 'T-1',
        name: 'Updated',
        priority: 1,
      });
    });

    it('delete should call task.delete.mutate', async () => {
      await taskService.delete('T-1');
      expect(lambdaClient.task.delete.mutate).toHaveBeenCalledWith({ id: 'T-1' });
    });

    it('updateStatus should pass status directly', async () => {
      await taskService.updateStatus('T-1', 'running');
      expect(lambdaClient.task.updateStatus.mutate).toHaveBeenCalledWith({
        error: undefined,
        id: 'T-1',
        status: 'running',
      });
    });

    it('run should merge id with params', async () => {
      await taskService.run('T-1', { prompt: 'Focus on tests' });
      expect(lambdaClient.task.run.mutate).toHaveBeenCalledWith({
        id: 'T-1',
        prompt: 'Focus on tests',
      });
    });

    it('addComment should pass all params', async () => {
      await taskService.addComment('T-1', 'Great work', { topicId: 'tpc_1' });
      expect(lambdaClient.task.addComment.mutate).toHaveBeenCalledWith({
        content: 'Great work',
        id: 'T-1',
        topicId: 'tpc_1',
      });
    });

    it('addDependency should default type to blocks', async () => {
      await taskService.addDependency('T-1', 'T-2');
      expect(lambdaClient.task.addDependency.mutate).toHaveBeenCalledWith({
        dependsOnId: 'T-2',
        taskId: 'T-1',
        type: 'blocks',
      });
    });

    it('updateConfig should call task.updateConfig.mutate', async () => {
      await taskService.updateConfig('T-1', { model: 'gpt-4o', provider: 'openai' });
      expect(lambdaClient.task.updateConfig.mutate).toHaveBeenCalledWith({
        config: { model: 'gpt-4o', provider: 'openai' },
        id: 'T-1',
      });
    });

    it('cancelTopic should call task.cancelTopic.mutate', async () => {
      await taskService.cancelTopic('tpc_1');
      expect(lambdaClient.task.cancelTopic.mutate).toHaveBeenCalledWith({ topicId: 'tpc_1' });
    });

    it('pinDocument should pass all params', async () => {
      await taskService.pinDocument('T-1', 'doc_1', 'user');
      expect(lambdaClient.task.pinDocument.mutate).toHaveBeenCalledWith({
        documentId: 'doc_1',
        pinnedBy: 'user',
        taskId: 'T-1',
      });
    });
  });

  describe('brief operations', () => {
    it('resolveBrief should call brief.resolve.mutate', async () => {
      await taskService.resolveBrief('brief_1', { action: 'approve' });
      expect(lambdaClient.brief.resolve.mutate).toHaveBeenCalledWith({
        action: 'approve',
        id: 'brief_1',
      });
    });

    it('markBriefRead should call brief.markRead.mutate', async () => {
      await taskService.markBriefRead('brief_1');
      expect(lambdaClient.brief.markRead.mutate).toHaveBeenCalledWith({ id: 'brief_1' });
    });
  });
});
