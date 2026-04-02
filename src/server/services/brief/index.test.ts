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

describe('BriefService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockAgentModel = {
    getAgentAvatarsByIds: vi.fn(),
  };

  const mockBriefModel = {
    list: vi.fn(),
    listUnresolved: vi.fn(),
  };

  const mockTaskModel = {
    getTreeAgentIdsForTaskIds: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentModel as any).mockImplementation(() => mockAgentModel);
    (BriefModel as any).mockImplementation(() => mockBriefModel);
    (TaskModel as any).mockImplementation(() => mockTaskModel);
  });

  describe('enrichBriefsWithAgents', () => {
    it('should return briefs with empty agents when no taskIds', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { id: 'b1', taskId: null, title: 'Brief 1' },
        { id: 'b2', taskId: null, title: 'Brief 2' },
      ] as any[];

      const result = await service.enrichBriefsWithAgents(briefs);

      expect(result).toHaveLength(2);
      expect(result[0].agents).toEqual([]);
      expect(result[1].agents).toEqual([]);
      expect(mockTaskModel.getTreeAgentIdsForTaskIds).not.toHaveBeenCalled();
    });

    it('should enrich briefs with agent data from task trees', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { id: 'b1', taskId: 'task-1', title: 'Brief 1' },
        { id: 'b2', taskId: 'task-2', title: 'Brief 2' },
      ] as any[];

      mockTaskModel.getTreeAgentIdsForTaskIds.mockResolvedValue({
        'task-1': ['agent-a', 'agent-b'],
        'task-2': ['agent-b', 'agent-c'],
      });

      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: '🤖', backgroundColor: null, id: 'agent-a', title: 'Agent A' },
        { avatar: '🧠', backgroundColor: '#fff', id: 'agent-b', title: 'Agent B' },
        { avatar: '🔧', backgroundColor: null, id: 'agent-c', title: 'Agent C' },
      ]);

      const result = await service.enrichBriefsWithAgents(briefs);

      expect(result[0].agents).toHaveLength(2);
      expect(result[0].agents[0].id).toBe('agent-a');
      expect(result[0].agents[1].id).toBe('agent-b');

      expect(result[1].agents).toHaveLength(2);
      expect(result[1].agents[0].id).toBe('agent-b');
      expect(result[1].agents[1].id).toBe('agent-c');

      expect(mockTaskModel.getTreeAgentIdsForTaskIds).toHaveBeenCalledWith(['task-1', 'task-2']);
      expect(mockAgentModel.getAgentAvatarsByIds).toHaveBeenCalledWith(
        expect.arrayContaining(['agent-a', 'agent-b', 'agent-c']),
      );
    });

    it('should handle briefs with mixed null and non-null taskIds', async () => {
      const service = new BriefService(db, userId);

      const briefs = [
        { id: 'b1', taskId: 'task-1', title: 'With task' },
        { id: 'b2', taskId: null, title: 'No task' },
      ] as any[];

      mockTaskModel.getTreeAgentIdsForTaskIds.mockResolvedValue({
        'task-1': ['agent-a'],
      });

      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: '🤖', backgroundColor: null, id: 'agent-a', title: 'Agent A' },
      ]);

      const result = await service.enrichBriefsWithAgents(briefs);

      expect(result[0].agents).toHaveLength(1);
      expect(result[1].agents).toEqual([]);
    });

    it('should handle task with no agents in tree', async () => {
      const service = new BriefService(db, userId);

      const briefs = [{ id: 'b1', taskId: 'task-1', title: 'Brief' }] as any[];

      mockTaskModel.getTreeAgentIdsForTaskIds.mockResolvedValue({});

      const result = await service.enrichBriefsWithAgents(briefs);

      expect(result[0].agents).toEqual([]);
      expect(mockAgentModel.getAgentAvatarsByIds).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should return enriched briefs with total', async () => {
      const service = new BriefService(db, userId);

      mockBriefModel.list.mockResolvedValue({
        briefs: [{ id: 'b1', taskId: null, title: 'Brief' }],
        total: 1,
      });

      const result = await service.list({ limit: 10, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.briefs).toHaveLength(1);
      expect(result.briefs[0].agents).toEqual([]);
      expect(mockBriefModel.list).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    });
  });

  describe('listUnresolved', () => {
    it('should return enriched unresolved briefs', async () => {
      const service = new BriefService(db, userId);

      mockBriefModel.listUnresolved.mockResolvedValue([
        { id: 'b1', taskId: null, title: 'Unresolved' },
      ]);

      const result = await service.listUnresolved();

      expect(result).toHaveLength(1);
      expect(result[0].agents).toEqual([]);
      expect(mockBriefModel.listUnresolved).toHaveBeenCalled();
    });
  });
});
