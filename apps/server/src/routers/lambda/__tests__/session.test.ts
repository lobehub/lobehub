// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionModel } from '@/database/models/session';
import { SessionGroupModel } from '@/database/models/sessionGroup';
import { assertCanEditResource } from '@/server/services/resourcePermission';

import { sessionRouter } from '../session';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/database/models/session', () => ({
  SessionModel: vi.fn(),
}));

vi.mock('@/database/models/sessionGroup', () => ({
  SessionGroupModel: vi.fn(),
}));

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: vi.fn(),
}));

const mockTrashAgent = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/trash', () => ({
  TrashService: vi.fn(function () {
    return { trashAgent: mockTrashAgent };
  }),
}));

describe('sessionRouter', () => {
  const userId = 'testUserId';
  let sessionModelMock: any;
  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertCanEditResource).mockResolvedValue();

    sessionModelMock = {
      findByIdOrSlug: vi.fn(),
      updateConfig: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(SessionModel).mockImplementation(function () {
      return sessionModelMock;
    });
    vi.mocked(SessionGroupModel).mockImplementation(function () {
      return {} as any;
    });

    mockCtx = {
      jwtPayload: { userId },
      userId,
    };
  });

  describe('updateSessionConfig workspace edit guard', () => {
    it('requires edit on the linked agent in workspace mode', async () => {
      sessionModelMock.findByIdOrSlug.mockResolvedValue({
        agent: { id: 'agent-1' },
        id: 'session-1',
      });

      const caller = sessionRouter.createCaller({ ...mockCtx, workspaceId: 'ws-1' });
      await caller.updateSessionConfig({ id: 'session-1', value: { model: 'gpt-4o-mini' } });

      expect(assertCanEditResource).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: 'agent-1',
          resourceType: 'agent',
          userId,
          workspaceId: 'ws-1',
        }),
      );
      expect(sessionModelMock.updateConfig).toHaveBeenCalledWith('session-1', {
        model: 'gpt-4o-mini',
      });
    });

    it('blocks the write when the guard denies edit', async () => {
      sessionModelMock.findByIdOrSlug.mockResolvedValue({
        agent: { id: 'agent-1' },
        id: 'session-1',
      });
      vi.mocked(assertCanEditResource).mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'denied' }),
      );

      const caller = sessionRouter.createCaller({ ...mockCtx, workspaceId: 'ws-1' });

      await expect(
        caller.updateSessionConfig({ id: 'session-1', value: { model: 'gpt-4o-mini' } }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(sessionModelMock.updateConfig).not.toHaveBeenCalled();
    });

    it('skips the guard in personal mode', async () => {
      const caller = sessionRouter.createCaller(mockCtx);
      await caller.updateSessionConfig({ id: 'session-1', value: { model: 'gpt-4o-mini' } });

      expect(sessionModelMock.findByIdOrSlug).not.toHaveBeenCalled();
      expect(assertCanEditResource).not.toHaveBeenCalled();
      expect(sessionModelMock.updateConfig).toHaveBeenCalled();
    });
  });

  describe('updateSessionChatConfig workspace edit guard', () => {
    it('requires edit on the linked agent in workspace mode', async () => {
      sessionModelMock.findByIdOrSlug.mockResolvedValue({
        agent: { id: 'agent-1' },
        id: 'session-1',
      });

      const caller = sessionRouter.createCaller({ ...mockCtx, workspaceId: 'ws-1' });
      await caller.updateSessionChatConfig({ id: 'session-1', value: { historyCount: 4 } });

      expect(assertCanEditResource).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: 'agent-1',
          resourceType: 'agent',
          userId,
          workspaceId: 'ws-1',
        }),
      );
      // The input schema fills other chatConfig defaults; only assert ours.
      expect(sessionModelMock.updateConfig).toHaveBeenCalledWith('session-1', {
        chatConfig: expect.objectContaining({ historyCount: 4 }),
      });
    });
  });

  describe('removeSession', () => {
    beforeEach(() => {
      sessionModelMock.findByIdOrSlug.mockResolvedValue({
        agent: { id: 'agent-1' },
        id: 'session-1',
        userId,
      });
      sessionModelMock.delete = vi
        .fn()
        .mockResolvedValue({ orphanedAgentIds: [], result: { count: 1 } });
      sessionModelMock.isSoleShellOfAgent = vi.fn();
    });

    it("sends the agent to the recycle bin when this is the agent's only session", async () => {
      sessionModelMock.isSoleShellOfAgent.mockResolvedValue(true);

      const caller = sessionRouter.createCaller(mockCtx);
      await caller.removeSession({ id: 'session-1' });

      expect(sessionModelMock.isSoleShellOfAgent).toHaveBeenCalledWith('session-1', 'agent-1');
      expect(mockTrashAgent).toHaveBeenCalledWith('agent-1');
      expect(sessionModelMock.delete).not.toHaveBeenCalled();
    });

    it('removes only this session when the agent is linked to other sessions', async () => {
      sessionModelMock.isSoleShellOfAgent.mockResolvedValue(false);

      const caller = sessionRouter.createCaller(mockCtx);
      await caller.removeSession({ id: 'session-1' });

      expect(mockTrashAgent).not.toHaveBeenCalled();
      expect(sessionModelMock.delete).toHaveBeenCalledWith('session-1');
    });
  });
});
