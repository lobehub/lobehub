// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const mockTopicFindById = vi.fn();
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({ findById: mockTopicFindById })),
}));

const mockShareCreate = vi.fn();
const mockShareGetByTopicId = vi.fn();
const mockShareUpdateVisibility = vi.fn();
const mockShareDeleteByTopicId = vi.fn();
vi.mock('@/database/models/topicShare', () => ({
  TopicShareModel: vi.fn(() => ({
    create: mockShareCreate,
    deleteByTopicId: mockShareDeleteByTopicId,
    getByTopicId: mockShareGetByTopicId,
    updateVisibility: mockShareUpdateVisibility,
  })),
}));

const mockAuditCreate = vi.fn();
vi.mock('@/database/models/workspaceAuditLog', () => ({
  WorkspaceAuditLogModel: vi.fn(() => ({ create: mockAuditCreate })),
}));

const mockAssertCanUseTopicTargets = vi.fn();
vi.mock('../_helpers/conversationResourceGuard', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    assertCanUseTopicTargets: (...args: unknown[]) => mockAssertCanUseTopicTargets(...args),
  };
});

const { topicRouter } = await import('../topic');

const creatorId = 'user-creator';
const memberId = 'user-member';
const workspaceId = 'ws-1';
const topicId = 'topic-1';

describe('topic share management gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTopicFindById.mockResolvedValue({ id: topicId, userId: creatorId });
    mockShareGetByTopicId.mockResolvedValue(null);
    mockShareCreate.mockResolvedValue({ id: 'share-1', topicId, visibility: 'private' });
    mockShareUpdateVisibility.mockResolvedValue({ id: 'share-1', topicId, visibility: 'link' });
  });

  describe('enableSharing', () => {
    it('allows a workspace member with co-edit access on the topic', async () => {
      mockAssertCanUseTopicTargets.mockResolvedValue(undefined);
      const caller = topicRouter.createCaller({ userId: memberId, workspaceId } as any);

      const result = await caller.enableSharing({ topicId });

      expect(mockAssertCanUseTopicTargets).toHaveBeenCalledWith(
        expect.objectContaining({ userId: memberId, workspaceId }),
        [topicId],
      );
      expect(mockShareCreate).toHaveBeenCalledWith(topicId, undefined);
      expect(result).toEqual({ id: 'share-1', topicId, visibility: 'private' });
    });

    it('rejects a workspace member without co-edit access', async () => {
      mockAssertCanUseTopicTargets.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'no use access' }),
      );
      const caller = topicRouter.createCaller({ userId: memberId, workspaceId } as any);

      await expect(caller.enableSharing({ topicId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockShareCreate).not.toHaveBeenCalled();
    });

    it('skips the co-edit guard for the topic creator', async () => {
      const caller = topicRouter.createCaller({ userId: creatorId, workspaceId } as any);

      await caller.enableSharing({ topicId });

      expect(mockAssertCanUseTopicTargets).not.toHaveBeenCalled();
      expect(mockShareCreate).toHaveBeenCalledWith(topicId, undefined);
    });

    it('skips the guard entirely in personal mode', async () => {
      const caller = topicRouter.createCaller({ userId: memberId } as any);

      await caller.enableSharing({ topicId });

      expect(mockTopicFindById).not.toHaveBeenCalled();
      expect(mockAssertCanUseTopicTargets).not.toHaveBeenCalled();
      expect(mockShareCreate).toHaveBeenCalledWith(topicId, undefined);
    });

    it('throws NOT_FOUND when the topic does not exist in the workspace', async () => {
      mockTopicFindById.mockResolvedValue(null);
      const caller = topicRouter.createCaller({ userId: memberId, workspaceId } as any);

      await expect(caller.enableSharing({ topicId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('updateShareVisibility', () => {
    it('allows a workspace member with co-edit access', async () => {
      mockAssertCanUseTopicTargets.mockResolvedValue(undefined);
      mockShareGetByTopicId.mockResolvedValue({ id: 'share-1', topicId, visibility: 'private' });
      const caller = topicRouter.createCaller({ userId: memberId, workspaceId } as any);

      const result = await caller.updateShareVisibility({ topicId, visibility: 'link' });

      expect(mockAssertCanUseTopicTargets).toHaveBeenCalledWith(
        expect.objectContaining({ userId: memberId, workspaceId }),
        [topicId],
      );
      expect(result).toEqual({ id: 'share-1', topicId, visibility: 'link' });
      // private -> link transition is audited
      expect(mockAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'resource.shared', userId: memberId }),
      );
    });

    it('rejects a workspace member without co-edit access', async () => {
      mockAssertCanUseTopicTargets.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'no use access' }),
      );
      const caller = topicRouter.createCaller({ userId: memberId, workspaceId } as any);

      await expect(
        caller.updateShareVisibility({ topicId, visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockShareUpdateVisibility).not.toHaveBeenCalled();
    });
  });

  describe('disableSharing', () => {
    it('allows a workspace member with co-edit access', async () => {
      mockAssertCanUseTopicTargets.mockResolvedValue(undefined);
      mockShareGetByTopicId.mockResolvedValue({ id: 'share-1', topicId, visibility: 'link' });
      mockShareDeleteByTopicId.mockResolvedValue({ rowCount: 1 });
      const caller = topicRouter.createCaller({ userId: memberId, workspaceId } as any);

      await caller.disableSharing({ topicId });

      expect(mockAssertCanUseTopicTargets).toHaveBeenCalledWith(
        expect.objectContaining({ userId: memberId, workspaceId }),
        [topicId],
      );
      expect(mockShareDeleteByTopicId).toHaveBeenCalledWith(topicId);
    });
  });
});
