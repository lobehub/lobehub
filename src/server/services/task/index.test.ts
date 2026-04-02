// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import { TaskService } from './index';

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(),
}));

describe('TaskService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockTaskModel = {
    findById: vi.fn(),
    findByIds: vi.fn(),
    findSubtasks: vi.fn(),
    getCheckpointConfig: vi.fn(),
    getComments: vi.fn(),
    getDependencies: vi.fn(),
    getDependenciesByTaskIds: vi.fn(),
    getReviewConfig: vi.fn(),
    getTreePinnedDocuments: vi.fn(),
    resolve: vi.fn(),
  };

  const mockTaskTopicModel = {
    findWithHandoff: vi.fn(),
  };

  const mockBriefModel = {
    findByTaskId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (TaskModel as any).mockImplementation(() => mockTaskModel);
    (TaskTopicModel as any).mockImplementation(() => mockTaskTopicModel);
    (BriefModel as any).mockImplementation(() => mockBriefModel);
  });

  describe('getTaskDetail', () => {
    it('should return null when task is not found', async () => {
      mockTaskModel.resolve.mockResolvedValue(null);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result).toBeNull();
      expect(mockTaskModel.resolve).toHaveBeenCalledWith('TASK-1');
    });

    it('should return task detail for a simple task with no subtasks or dependencies', async () => {
      const task = {
        assigneeAgentId: 'agent-1',
        assigneeUserId: 'user-1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        description: 'A simple task',
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: 'Do something',
        lastHeartbeatAt: null,
        name: 'Task One',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result).not.toBeNull();
      expect(result?.identifier).toBe('TASK-1');
      expect(result?.name).toBe('Task One');
      expect(result?.description).toBe('A simple task');
      expect(result?.status).toBe('todo');
      expect(result?.priority).toBe('normal');
      expect(result?.agentId).toBe('agent-1');
      expect(result?.userId).toBe('user-1');
      expect(result?.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(result?.subtasks).toEqual([]);
      expect(result?.dependencies).toEqual([]);
      expect(result?.activities).toBeUndefined();
      expect(result?.workspace).toBeUndefined();
      expect(result?.parent).toBeNull();
    });

    it('should resolve parent task info when parentTaskId is set', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_002',
        identifier: 'TASK-2',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Child Task',
        parentTaskId: 'task_001',
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const parentTask = { id: 'task_001', identifier: 'TASK-1', name: 'Parent Task' };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.findById.mockResolvedValue(parentTask);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-2');

      expect(result?.parent).toEqual({ identifier: 'TASK-1', name: 'Parent Task' });
      expect(mockTaskModel.findById).toHaveBeenCalledWith('task_001');
    });

    it('should return null parent when parentTaskId not found in db', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_002',
        identifier: 'TASK-2',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Child Task',
        parentTaskId: 'task_missing',
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.findById.mockResolvedValue(null);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-2');

      expect(result?.parent).toBeNull();
    });

    it('should include subtasks with blockedBy info', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Parent Task',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const subtasks = [
        { id: 'task_002', identifier: 'TASK-2', name: 'Sub 1', priority: 'normal', status: 'todo' },
        {
          id: 'task_003',
          identifier: 'TASK-3',
          name: 'Sub 2',
          priority: 'high',
          status: 'in_progress',
        },
      ];

      // task_003 depends on task_002
      const subtaskDeps = [{ dependsOnId: 'task_002', taskId: 'task_003' }];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue(subtasks);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.getDependenciesByTaskIds.mockResolvedValue(subtaskDeps);
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.subtasks).toHaveLength(2);
      expect(result?.subtasks?.[0]).toEqual({
        blockedBy: undefined,
        identifier: 'TASK-2',
        name: 'Sub 1',
        priority: 'normal',
        status: 'todo',
      });
      expect(result?.subtasks?.[1]).toEqual({
        blockedBy: 'TASK-2',
        identifier: 'TASK-3',
        name: 'Sub 2',
        priority: 'high',
        status: 'in_progress',
      });
    });

    it('should include dependencies with identifier and name', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_003',
        identifier: 'TASK-3',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 3',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const dependencies = [{ dependsOnId: 'task_002', taskId: 'task_003', type: 'blocks' }];
      const depTasks = [{ id: 'task_002', identifier: 'TASK-2', name: 'Task 2' }];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue(dependencies);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue(depTasks);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-3');

      expect(result?.dependencies).toEqual([
        { dependsOn: 'TASK-2', name: 'Task 2', type: 'blocks' },
      ]);
    });

    it('should fall back to raw dependsOnId when dep task is not found', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_003',
        identifier: 'TASK-3',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 3',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const dependencies = [{ dependsOnId: 'task_missing', taskId: 'task_003', type: 'blocks' }];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue(dependencies);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-3');

      expect(result?.dependencies).toEqual([
        { dependsOn: 'task_missing', name: undefined, type: 'blocks' },
      ]);
    });

    it('should build activities sorted by time ascending', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const topics = [
        {
          createdAt: new Date('2024-01-03T00:00:00Z'),
          handoff: { title: 'Topic A' },
          seq: 1,
          status: 'completed',
          topicId: 'topic-1',
        },
      ];

      const briefs = [
        {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          id: 'brief-1',
          priority: 'normal',
          resolvedAction: null,
          resolvedComment: null,
          summary: 'Brief summary',
          title: 'Brief A',
          type: 'insight',
        },
      ];

      const comments = [
        {
          authorAgentId: 'agent-1',
          content: 'A comment',
          createdAt: new Date('2024-01-02T00:00:00Z'),
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue(briefs);
      mockTaskModel.getComments.mockResolvedValue(comments);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.activities).toHaveLength(3);
      // sorted ascending: brief (Jan 1) < comment (Jan 2) < topic (Jan 3)
      expect(result?.activities?.[0].type).toBe('brief');
      expect(result?.activities?.[1].type).toBe('comment');
      expect(result?.activities?.[2].type).toBe('topic');
    });

    it('should include topic count when topics exist', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const topics = [
        { createdAt: new Date(), handoff: null, seq: 1, status: 'completed', topicId: 'topic-1' },
        { createdAt: new Date(), handoff: null, seq: 2, status: 'completed', topicId: 'topic-2' },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.topicCount).toBe(2);
    });

    it('should not include topicCount when no topics exist', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.topicCount).toBeUndefined();
    });

    it('should build workspace tree nodes from pinned documents', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const workspace = {
        nodeMap: {
          'doc-1': {
            charCount: 500,
            createdAt: '2024-01-01T00:00:00Z',
            fileType: 'markdown',
            sourceTaskIdentifier: 'TASK-2',
            title: 'Document One',
          },
          'doc-2': {
            charCount: 200,
            createdAt: '2024-01-02T00:00:00Z',
            fileType: 'text',
            sourceTaskIdentifier: null,
            title: 'Document Two',
          },
        },
        tree: [
          {
            children: [{ children: [], id: 'doc-2' }],
            id: 'doc-1',
          },
        ],
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue(workspace);
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.workspace).toHaveLength(1);
      const rootNode = result?.workspace?.[0];
      expect(rootNode?.documentId).toBe('doc-1');
      expect(rootNode?.title).toBe('Document One');
      expect(rootNode?.fileType).toBe('markdown');
      expect(rootNode?.size).toBe(500);
      expect(rootNode?.sourceTaskIdentifier).toBe('TASK-2');
      expect(rootNode?.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(rootNode?.children).toHaveLength(1);
      expect(rootNode?.children?.[0]?.documentId).toBe('doc-2');
      expect(rootNode?.children?.[0]?.title).toBe('Document Two');
    });

    it('should include heartbeat info when heartbeatTimeout or lastHeartbeatAt is set', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: 30,
        heartbeatTimeout: 60,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: new Date('2024-01-01T12:00:00Z'),
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'running',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.heartbeat).toEqual({
        interval: 30,
        lastAt: '2024-01-01T12:00:00.000Z',
        timeout: 60,
      });
    });

    it('should not include heartbeat when neither heartbeatTimeout nor lastHeartbeatAt is set', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.heartbeat).toBeUndefined();
    });

    it('should gracefully handle failing optional calls via catch', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      // Simulate optional calls failing
      mockTaskTopicModel.findWithHandoff.mockRejectedValue(new Error('DB error'));
      mockBriefModel.findByTaskId.mockRejectedValue(new Error('DB error'));
      mockTaskModel.getComments.mockRejectedValue(new Error('DB error'));
      mockTaskModel.getTreePinnedDocuments.mockRejectedValue(new Error('DB error'));
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      // Should not throw and return partial result
      expect(result).not.toBeNull();
      expect(result?.identifier).toBe('TASK-1');
      expect(result?.activities).toBeUndefined();
      expect(result?.workspace).toBeUndefined();
    });

    it('should build brief activities with resolvedAction concatenated with resolvedComment', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const briefs = [
        {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          id: 'brief-1',
          priority: 'urgent',
          resolvedAction: 'approved',
          resolvedComment: 'looks good',
          summary: 'Review brief',
          title: 'Approval',
          type: 'decision',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue(briefs);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.activities?.[0]).toMatchObject({
        briefType: 'decision',
        id: 'brief-1',
        priority: 'urgent',
        resolvedAction: 'approved: looks good',
        summary: 'Review brief',
        title: 'Approval',
        type: 'brief',
      });
    });

    it('should use only resolvedAction when resolvedComment is absent', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const briefs = [
        {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          id: 'brief-1',
          priority: 'normal',
          resolvedAction: 'retry',
          resolvedComment: null,
          summary: 'Retry brief',
          title: 'Retry',
          type: 'insight',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue(briefs);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.activities?.[0]).toMatchObject({
        resolvedAction: 'retry',
        type: 'brief',
      });
    });

    it('should use topic handoff title with fallback to Untitled', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const topics = [
        {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          handoff: null,
          seq: 1,
          status: 'completed',
          topicId: 'topic-1',
        },
        {
          createdAt: new Date('2024-01-02T00:00:00Z'),
          handoff: { title: 'Named Topic' },
          seq: 2,
          status: 'completed',
          topicId: 'topic-2',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      const topicActivities = result?.activities?.filter((a) => a.type === 'topic');
      expect(topicActivities?.[0].title).toBe('Untitled');
      expect(topicActivities?.[1].title).toBe('Named Topic');
    });

    it('should place activities without time at the end of sorted list', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const briefs = [
        {
          createdAt: null,
          id: 'brief-1',
          priority: 'normal',
          resolvedAction: null,
          resolvedComment: null,
          summary: 'No time brief',
          title: 'No Time',
          type: 'insight',
        },
      ];

      const comments = [
        {
          authorAgentId: null,
          content: 'With time',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findSubtasks.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue(briefs);
      mockTaskModel.getComments.mockResolvedValue(comments);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getReviewConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.activities).toHaveLength(2);
      // comment with time should come first, brief without time at end
      expect(result?.activities?.[0].type).toBe('comment');
      expect(result?.activities?.[1].type).toBe('brief');
    });
  });
});
