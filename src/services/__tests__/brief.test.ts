import { beforeEach, describe, expect, it, vi } from 'vitest';

import { briefService } from '../brief';

const mockQuery = vi.fn();
const mockBriefMutate = vi.fn();

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    brief: {
      listUnresolved: { query: (...args: any[]) => mockQuery(...args) },
      markRead: { mutate: (...args: any[]) => mockBriefMutate(...args) },
      resolve: { mutate: (...args: any[]) => mockBriefMutate(...args) },
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
});
