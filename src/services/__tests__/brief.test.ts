import { beforeEach, describe, expect, it, vi } from 'vitest';

import { briefService } from '../brief';

const mockQuery = vi.fn();
const mockBriefMutate = vi.fn();
const mockTaskMutate = vi.fn();

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    brief: {
      listUnresolved: { query: (...args: any[]) => mockQuery(...args) },
      markRead: { mutate: (...args: any[]) => mockBriefMutate(...args) },
      resolve: { mutate: (...args: any[]) => mockBriefMutate(...args) },
    },
    task: {
      addComment: { mutate: (...args: any[]) => mockTaskMutate(...args) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BriefService', () => {
  describe('listUnresolved', () => {
    it('should call listUnresolved query', async () => {
      const mockData = { data: [{ id: 'brief-1', title: 'Test' }], success: true };
      mockQuery.mockResolvedValueOnce(mockData);

      const result = await briefService.listUnresolved();

      expect(mockQuery).toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });
  });

  describe('resolve', () => {
    it('should call resolve with id and params', async () => {
      mockBriefMutate.mockResolvedValueOnce({ data: {}, success: true });

      await briefService.resolve('brief-1', { action: 'approve', comment: 'looks good' });

      expect(mockBriefMutate).toHaveBeenCalledWith({
        action: 'approve',
        comment: 'looks good',
        id: 'brief-1',
      });
    });

    it('should call resolve with only id when no params', async () => {
      mockBriefMutate.mockResolvedValueOnce({ data: {}, success: true });

      await briefService.resolve('brief-1');

      expect(mockBriefMutate).toHaveBeenCalledWith({ id: 'brief-1' });
    });
  });

  describe('markRead', () => {
    it('should call markRead with id', async () => {
      mockBriefMutate.mockResolvedValueOnce({ data: {}, success: true });

      await briefService.markRead('brief-1');

      expect(mockBriefMutate).toHaveBeenCalledWith({ id: 'brief-1' });
    });
  });

  describe('addComment', () => {
    it('should call task.addComment with correct params', async () => {
      mockTaskMutate.mockResolvedValueOnce({ data: {}, success: true });

      await briefService.addComment('task-1', 'my feedback', 'brief-1');

      expect(mockTaskMutate).toHaveBeenCalledWith({
        briefId: 'brief-1',
        content: 'my feedback',
        id: 'task-1',
      });
    });

    it('should call task.addComment without briefId when not provided', async () => {
      mockTaskMutate.mockResolvedValueOnce({ data: {}, success: true });

      await briefService.addComment('task-1', 'feedback text');

      expect(mockTaskMutate).toHaveBeenCalledWith({
        briefId: undefined,
        content: 'feedback text',
        id: 'task-1',
      });
    });
  });
});
