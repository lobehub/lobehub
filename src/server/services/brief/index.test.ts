// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';

import { BriefService } from './index';

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(),
}));

// Avoid pulling the real TaskRunnerService (which drags ModelRuntime) into the
// dynamic import the brief service performs after auto-completing a task.
const cascadeOnCompletion = vi.fn().mockResolvedValue({ failed: [], paused: [], started: [] });
vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn().mockImplementation(() => ({ cascadeOnCompletion })),
}));

describe('BriefService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockAgentModel = {
    getAgentAvatarsByIds: vi.fn(),
  };

  const mockBriefModel = {
    findById: vi.fn(),
    list: vi.fn(),
    listUnresolved: vi.fn(),
    listUnresolvedEnriched: vi.fn(),
    resolve: vi.fn(),
    updateMetadata: vi.fn(),
  };

  const mockTaskModel = {
    findById: vi.fn(),
    findByIds: vi.fn(),
    getTreeAgentIdsForTaskIds: vi.fn(),
    getUnlockedTasks: vi.fn(),
    updateStatus: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentModel as any).mockImplementation(() => mockAgentModel);
    (BriefModel as any).mockImplementation(() => mockBriefModel);
    (TaskModel as any).mockImplementation(() => mockTaskModel);
    // Default: no downstream tasks unlocked. Specific tests can override.
    mockTaskModel.getUnlockedTasks.mockResolvedValue([]);
    mockBriefModel.findById.mockResolvedValue(null);
  });

  describe('enrichBriefsWithAgents', () => {
    beforeEach(() => {
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getTreeAgentIdsForTaskIds.mockResolvedValue({});
    });

    it('should return briefs with null agent when no taskIds and no agentIds', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: null, id: 'b1', taskId: null, title: 'Brief 1' },
        { agentId: null, id: 'b2', taskId: null, title: 'Brief 2' },
      ] as any[];

      const result = await service.enrichBriefsWithAgents(briefs);

      expect(result).toHaveLength(2);
      expect(result[0].agent).toBeNull();
      expect(result[0].taskStatus).toBeNull();
      expect(result[1].agent).toBeNull();
      expect(result[1].taskStatus).toBeNull();
      expect(mockTaskModel.findByIds).not.toHaveBeenCalled();
      expect(mockAgentModel.getAgentAvatarsByIds).not.toHaveBeenCalled();
    });

    it('should attach the producing agent and taskStatus from the parent task', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: 'agent-a', id: 'b1', taskId: 'task-1', title: 'Brief 1' },
        { agentId: 'agent-c', id: 'b2', taskId: 'task-2', title: 'Brief 2' },
      ] as any[];

      mockTaskModel.findByIds.mockResolvedValue([
        { id: 'task-1', status: 'scheduled' },
        { id: 'task-2', status: 'paused' },
      ]);

      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: '🤖', backgroundColor: null, id: 'agent-a', title: 'Agent A' },
        { avatar: '🔧', backgroundColor: null, id: 'agent-c', title: 'Agent C' },
      ]);

      const result = await service.enrichBriefsWithAgents(briefs, { includeTreeAgents: true });

      expect(result[0].agent).toEqual({
        avatar: '🤖',
        backgroundColor: null,
        id: 'agent-a',
        title: 'Agent A',
      });
      expect(result[0].taskStatus).toBe('scheduled');
      expect(result[1].agent).toEqual({
        avatar: '🔧',
        backgroundColor: null,
        id: 'agent-c',
        title: 'Agent C',
      });
      expect(result[1].taskStatus).toBe('paused');

      expect(mockTaskModel.getTreeAgentIdsForTaskIds).toHaveBeenCalledWith(['task-1', 'task-2']);
      expect(mockTaskModel.findByIds).toHaveBeenCalledWith(['task-1', 'task-2']);
      expect(mockAgentModel.getAgentAvatarsByIds).toHaveBeenCalledWith(
        expect.arrayContaining(['agent-a', 'agent-c']),
      );
    });

    it('should handle briefs with mixed null and non-null agentIds and taskIds', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: 'agent-a', id: 'b1', taskId: 'task-1', title: 'With task' },
        { agentId: null, id: 'b2', taskId: null, title: 'No task' },
      ] as any[];

      mockTaskModel.findByIds.mockResolvedValue([{ id: 'task-1', status: 'scheduled' }]);

      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: '🤖', backgroundColor: null, id: 'agent-a', title: 'Agent A' },
      ]);

      const result = await service.enrichBriefsWithAgents(briefs);

      expect(result[0].agent).toEqual({
        avatar: '🤖',
        backgroundColor: null,
        id: 'agent-a',
        title: 'Agent A',
      });
      expect(result[0].taskStatus).toBe('scheduled');
      expect(result[1].agent).toBeNull();
      expect(result[1].taskStatus).toBeNull();
    });

    it('should leave agent null when the producing agent has been deleted', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: 'agent-gone', id: 'b1', taskId: 'task-1', title: 'Brief' },
      ] as any[];

      mockTaskModel.findByIds.mockResolvedValue([{ id: 'task-1', status: 'paused' }]);
      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([]);

      const result = await service.enrichBriefsWithAgents(briefs);

      expect(result[0].agent).toBeNull();
      expect(result[0].taskStatus).toBe('paused');
      expect(mockAgentModel.getAgentAvatarsByIds).toHaveBeenCalledWith(['agent-gone']);
    });

    it('should enrich direct agent briefs without requiring a task id', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        {
          agentId: 'agent-direct',
          id: 'b1',
          taskId: null,
          title: 'Nightly self-review',
          trigger: 'agent-signal:nightly-review',
        },
      ] as any[];

      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        {
          avatar: '🤖',
          backgroundColor: '#fff',
          id: 'agent-direct',
          title: 'Reviewer Agent',
        },
      ]);

      const result = await service.enrichBriefsWithAgents(briefs, { includeTreeAgents: true });

      expect(result[0].agents).toEqual([
        {
          avatar: '🤖',
          backgroundColor: '#fff',
          id: 'agent-direct',
          title: 'Reviewer Agent',
        },
      ]);
      expect(result[0].taskStatus).toBeNull();
      expect(mockTaskModel.getTreeAgentIdsForTaskIds).not.toHaveBeenCalled();
      expect(mockTaskModel.findByIds).not.toHaveBeenCalled();
      expect(mockAgentModel.getAgentAvatarsByIds).toHaveBeenCalledWith(['agent-direct']);
    });

    it('should preserve direct-agent priority and deduplicate task-tree agents', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: 'agent-a', id: 'b1', taskId: 'task-1', title: 'Brief 1' },
      ] as any[];

      mockTaskModel.getTreeAgentIdsForTaskIds.mockResolvedValue({
        'task-1': ['agent-a', 'agent-b'],
      });
      mockTaskModel.findByIds.mockResolvedValue([{ id: 'task-1', status: 'scheduled' }]);

      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: '🤖', backgroundColor: null, id: 'agent-a', title: 'Agent A' },
        { avatar: '🧠', backgroundColor: '#fff', id: 'agent-b', title: 'Agent B' },
      ]);

      const result = await service.enrichBriefsWithAgents(briefs, { includeTreeAgents: true });

      expect(result[0].agents.map((agent) => agent.id)).toEqual(['agent-a', 'agent-b']);
    });

    it('should default to skipping the task-tree CTE and return empty agents[]', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: 'agent-a', id: 'b1', taskId: 'task-1', title: 'Brief 1' },
      ] as any[];

      mockTaskModel.findByIds.mockResolvedValue([{ id: 'task-1', status: 'scheduled' }]);
      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: '🤖', backgroundColor: null, id: 'agent-a', title: 'Agent A' },
      ]);

      const result = await service.enrichBriefsWithAgents(briefs);

      expect(result[0].agent).toEqual({
        avatar: '🤖',
        backgroundColor: null,
        id: 'agent-a',
        title: 'Agent A',
      });
      expect(result[0].taskStatus).toBe('scheduled');
      expect(result[0].agents).toEqual([]);
      expect(mockTaskModel.getTreeAgentIdsForTaskIds).not.toHaveBeenCalled();
      // direct-agent ids are passed straight through, no need to wait on the CTE.
      expect(mockAgentModel.getAgentAvatarsByIds).toHaveBeenCalledWith(['agent-a']);
    });
  });

  describe('enrichBriefAgentOnly', () => {
    it('should return briefs with null agent when no agentIds and skip db calls', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: null, id: 'b1', taskId: 'task-1', title: 'Brief 1' },
        { agentId: null, id: 'b2', taskId: null, title: 'Brief 2' },
      ] as any[];

      const result = await service.enrichBriefAgentOnly(briefs);

      expect(result).toHaveLength(2);
      expect(result[0].agent).toBeNull();
      expect(result[1].agent).toBeNull();
      expect(mockAgentModel.getAgentAvatarsByIds).not.toHaveBeenCalled();
      expect(mockTaskModel.findByIds).not.toHaveBeenCalled();
      expect(mockTaskModel.getTreeAgentIdsForTaskIds).not.toHaveBeenCalled();
    });

    it('should attach the direct producing agent without calling task tree CTE', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: 'agent-a', id: 'b1', taskId: 'task-1', title: 'Brief 1' },
        { agentId: 'agent-b', id: 'b2', taskId: 'task-2', title: 'Brief 2' },
      ] as any[];

      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: '🤖', backgroundColor: null, id: 'agent-a', title: 'Agent A' },
        { avatar: '🔧', backgroundColor: null, id: 'agent-b', title: 'Agent B' },
      ]);

      const result = await service.enrichBriefAgentOnly(briefs);

      expect(result[0].agent).toEqual({
        avatar: '🤖',
        backgroundColor: null,
        id: 'agent-a',
        title: 'Agent A',
      });
      expect(result[1].agent).toEqual({
        avatar: '🔧',
        backgroundColor: null,
        id: 'agent-b',
        title: 'Agent B',
      });
      expect(mockAgentModel.getAgentAvatarsByIds).toHaveBeenCalledWith(
        expect.arrayContaining(['agent-a', 'agent-b']),
      );
      expect(mockTaskModel.findByIds).not.toHaveBeenCalled();
      expect(mockTaskModel.getTreeAgentIdsForTaskIds).not.toHaveBeenCalled();
    });

    it('should leave agent null when the producing agent has been deleted', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { agentId: 'agent-gone', id: 'b1', taskId: 'task-1', title: 'Brief' },
      ] as any[];

      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([]);

      const result = await service.enrichBriefAgentOnly(briefs);

      expect(result[0].agent).toBeNull();
      expect(mockAgentModel.getAgentAvatarsByIds).toHaveBeenCalledWith(['agent-gone']);
    });
  });

  describe('list', () => {
    it('should return enriched briefs with total', async () => {
      const service = new BriefService(db, userId);

      mockBriefModel.list.mockResolvedValue({
        briefs: [{ agentId: null, id: 'b1', taskId: null, title: 'Brief' }],
        total: 1,
      });

      const result = await service.list({ limit: 10, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.briefs).toHaveLength(1);
      expect(result.briefs[0].agent).toBeNull();
      expect(mockBriefModel.list).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    });
  });

  describe('listUnresolved', () => {
    it('should map joined rows into BriefWithAgent without re-fetching', async () => {
      const service = new BriefService(db, userId);

      mockBriefModel.listUnresolvedEnriched.mockResolvedValue([
        {
          agentAvatar: null,
          agentBackgroundColor: null,
          agentRowId: null,
          agentTitle: null,
          brief: { agentId: null, id: 'b1', taskId: null, title: 'Solo' },
          taskStatus: null,
        },
        {
          agentAvatar: '🤖',
          agentBackgroundColor: '#fff',
          agentRowId: 'agent-a',
          agentTitle: 'Agent A',
          brief: { agentId: 'agent-a', id: 'b2', taskId: 'task-1', title: 'With Task' },
          taskStatus: 'scheduled',
        },
      ]);

      const result = await service.listUnresolved();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        agent: null,
        agents: [],
        id: 'b1',
        taskStatus: null,
      });
      expect(result[1]).toMatchObject({
        agent: { avatar: '🤖', backgroundColor: '#fff', id: 'agent-a', title: 'Agent A' },
        agents: [],
        id: 'b2',
        taskStatus: 'scheduled',
      });
      // No follow-up enrichment SQLs.
      expect(mockTaskModel.findByIds).not.toHaveBeenCalled();
      expect(mockTaskModel.getTreeAgentIdsForTaskIds).not.toHaveBeenCalled();
      expect(mockAgentModel.getAgentAvatarsByIds).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('should complete the task when approving a result brief on a non-scheduled task', async () => {
      const service = new BriefService(db, userId);
      mockBriefModel.resolve.mockResolvedValue({
        id: 'b1',
        taskId: 'task-1',
        type: 'result',
      });
      mockTaskModel.findById.mockResolvedValue({ id: 'task-1', status: 'paused' });

      const brief = await service.resolve('b1', { action: 'approve' });

      expect(brief).toEqual({ id: 'b1', taskId: 'task-1', type: 'result' });
      expect(mockBriefModel.resolve).toHaveBeenCalledWith('b1', { action: 'approve' });
      expect(mockTaskModel.updateStatus).toHaveBeenCalledWith('task-1', 'completed', {
        error: null,
      });
      // Brief approval must trigger downstream kickoff via the runner so
      // dependents don't sit in `backlog` waiting for a manual nudge.
      expect(cascadeOnCompletion).toHaveBeenCalledWith('task-1');
    });

    it('should NOT complete the task when approving a decision brief (mid-execution checkpoint)', async () => {
      const service = new BriefService(db, userId);
      mockBriefModel.resolve.mockResolvedValue({
        id: 'b2',
        taskId: 'task-2',
        type: 'decision',
      });

      await service.resolve('b2', { action: 'approve' });

      // decision briefs are non-terminal checkpoints — approving must not complete
      // the task or resume/continue flows break.
      expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
      expect(mockTaskModel.findById).not.toHaveBeenCalled();
    });

    it('should not change task status for non-approve actions', async () => {
      const service = new BriefService(db, userId);
      mockBriefModel.resolve.mockResolvedValue({
        id: 'b3',
        taskId: 'task-3',
        type: 'result',
      });

      await service.resolve('b3', { action: 'feedback', comment: 'tweak the tone' });

      expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
    });

    it('should not change task status when approving a non-result brief', async () => {
      const service = new BriefService(db, userId);
      mockBriefModel.resolve.mockResolvedValue({
        id: 'b4',
        taskId: 'task-4',
        type: 'insight',
      });

      await service.resolve('b4', { action: 'approve' });

      expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
    });

    it('should not change task status when brief has no taskId', async () => {
      const service = new BriefService(db, userId);
      mockBriefModel.resolve.mockResolvedValue({
        id: 'b5',
        taskId: null,
        type: 'result',
      });

      await service.resolve('b5', { action: 'approve' });

      expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
    });

    it('should return null and skip task update when brief is not found', async () => {
      const service = new BriefService(db, userId);
      mockBriefModel.resolve.mockResolvedValue(null);

      const result = await service.resolve('missing', { action: 'approve' });

      expect(result).toBeNull();
      expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
    });

    it('should NOT complete a task parked at status="scheduled" when approving its result brief', async () => {
      const service = new BriefService(db, userId);
      mockBriefModel.resolve.mockResolvedValue({
        id: 'b6',
        taskId: 'task-6',
        type: 'result',
      });
      mockTaskModel.findById.mockResolvedValue({ id: 'task-6', status: 'scheduled' });

      await service.resolve('b6', { action: 'approve' });

      // status='scheduled' means the task is parked between automated runs
      // (heartbeat or schedule). Approving one occurrence is a UI dismissal —
      // the next tick must still surface, so don't flip the task to completed.
      expect(mockTaskModel.findById).toHaveBeenCalledWith('task-6');
      expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
    });

    it('should not complete the task if it has been deleted between resolving and updating', async () => {
      const service = new BriefService(db, userId);
      mockBriefModel.resolve.mockResolvedValue({
        id: 'b7',
        taskId: 'task-gone',
        type: 'result',
      });
      mockTaskModel.findById.mockResolvedValue(null);

      await service.resolve('b7', { action: 'approve' });

      expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
    });
  });
});
