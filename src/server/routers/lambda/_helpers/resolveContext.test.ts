import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  batchResolveAgentIdFromSessions,
  resolveAgentIdFromSession,
  resolveContext,
} from './resolveContext';

// Mock the database module
vi.mock('@/database/schemas', () => ({
  agentsToSessions: {
    agentId: 'agent_id',
    sessionId: 'session_id',
    userId: 'user_id',
  },
}));

describe('resolveContext', () => {
  const mockUserId = 'user-1';

  // Helper to create a mock database
  const createMockDb = (queryResult: any[] = []) => {
    const mockLimit = vi.fn().mockResolvedValue(queryResult);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    return {
      select: mockSelect,
      _mocks: { mockSelect, mockFrom, mockWhere, mockLimit },
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveContext', () => {
    it('should return sessionId when only sessionId is provided', async () => {
      const mockDb = createMockDb([]);

      const result = await resolveContext(
        { sessionId: 'session-1', topicId: 'topic-1' },
        mockDb,
        mockUserId,
      );

      expect(result).toEqual({
        agentId: null,
        groupId: null,
        sessionId: 'session-1',
        threadId: null,
        topicId: 'topic-1',
      });
      // Should not query database when no agentId
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should resolve agentId to sessionId when agentId is provided', async () => {
      const mockDb = createMockDb([{ sessionId: 'resolved-session-1' }]);

      const result = await resolveContext({ agentId: 'agent-1' }, mockDb, mockUserId);

      expect(result.sessionId).toBe('resolved-session-1');
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should prefer agentId over sessionId when both are provided', async () => {
      const mockDb = createMockDb([{ sessionId: 'resolved-from-agent' }]);

      const result = await resolveContext(
        { agentId: 'agent-1', sessionId: 'original-session' },
        mockDb,
        mockUserId,
      );

      // Should use the sessionId resolved from agentId, not the provided sessionId
      expect(result.sessionId).toBe('resolved-from-agent');
    });

    it('should return null sessionId when agentId is not found in database', async () => {
      const mockDb = createMockDb([]); // Empty result

      const result = await resolveContext({ agentId: 'non-existent-agent' }, mockDb, mockUserId);

      // When agentId doesn't exist and no sessionId provided, should return null
      expect(result.sessionId).toBeNull();
    });

    it('should fall back to provided sessionId when agentId is not found', async () => {
      const mockDb = createMockDb([]); // Empty result - agentId not found

      const result = await resolveContext(
        { agentId: 'non-existent-agent', sessionId: 'fallback-session' },
        mockDb,
        mockUserId,
      );

      // When agentId doesn't resolve, keep the original sessionId
      expect(result.sessionId).toBe('fallback-session');
    });

    it('should pass through all context fields correctly', async () => {
      const mockDb = createMockDb([]);

      const result = await resolveContext(
        {
          sessionId: 'session-1',
          topicId: 'topic-1',
          threadId: 'thread-1',
          groupId: 'group-1',
        },
        mockDb,
        mockUserId,
      );

      expect(result).toEqual({
        agentId: null,
        sessionId: 'session-1',
        topicId: 'topic-1',
        threadId: 'thread-1',
        groupId: 'group-1',
      });
    });

    it('should handle null values in input', async () => {
      const mockDb = createMockDb([]);

      const result = await resolveContext(
        {
          sessionId: null,
          topicId: null,
          threadId: null,
          groupId: null,
        },
        mockDb,
        mockUserId,
      );

      expect(result).toEqual({
        agentId: null,
        sessionId: null,
        topicId: null,
        threadId: null,
        groupId: null,
      });
    });

    it('should handle undefined values in input', async () => {
      const mockDb = createMockDb([]);

      const result = await resolveContext({}, mockDb, mockUserId);

      expect(result).toEqual({
        agentId: null,
        sessionId: null,
        topicId: null,
        threadId: null,
        groupId: null,
      });
    });
  });

  describe('resolveAgentIdFromSession', () => {
    it('should resolve sessionId to agentId', async () => {
      const mockDb = createMockDb([{ agentId: 'resolved-agent-1' }]);

      const result = await resolveAgentIdFromSession('session-1', mockDb, mockUserId);

      expect(result).toBe('resolved-agent-1');
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return undefined when sessionId is not found', async () => {
      const mockDb = createMockDb([]); // Empty result

      const result = await resolveAgentIdFromSession('non-existent-session', mockDb, mockUserId);

      expect(result).toBeUndefined();
    });

    it('should query with correct userId filter', async () => {
      const mockLimit = vi.fn().mockResolvedValue([{ agentId: 'agent-1' }]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
      const mockDb = { select: mockSelect } as any;

      await resolveAgentIdFromSession('session-1', mockDb, 'specific-user');

      expect(mockWhere).toHaveBeenCalled();
      // The where clause should be called with userId filter
    });
  });

  describe('batchResolveAgentIdFromSessions', () => {
    // Helper to create a mock database for batch queries (no limit)
    const createBatchMockDb = (queryResult: any[] = []) => {
      const mockWhere = vi.fn().mockResolvedValue(queryResult);
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

      return {
        select: mockSelect,
        _mocks: { mockSelect, mockFrom, mockWhere },
      } as any;
    };

    it('should return empty map when sessionIds is empty', async () => {
      const mockDb = createBatchMockDb([]);

      const result = await batchResolveAgentIdFromSessions([], mockDb, 'user-1');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should resolve multiple sessionIds to agentIds', async () => {
      const mockDb = createBatchMockDb([
        { sessionId: 'session-1', agentId: 'agent-1' },
        { sessionId: 'session-2', agentId: 'agent-2' },
      ]);

      const result = await batchResolveAgentIdFromSessions(
        ['session-1', 'session-2'],
        mockDb,
        'user-1',
      );

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('session-1')).toBe('agent-1');
      expect(result.get('session-2')).toBe('agent-2');
    });

    it('should handle partial matches', async () => {
      const mockDb = createBatchMockDb([{ sessionId: 'session-1', agentId: 'agent-1' }]);

      const result = await batchResolveAgentIdFromSessions(
        ['session-1', 'session-not-found'],
        mockDb,
        'user-1',
      );

      expect(result.size).toBe(1);
      expect(result.get('session-1')).toBe('agent-1');
      expect(result.get('session-not-found')).toBeUndefined();
    });
  });
});
