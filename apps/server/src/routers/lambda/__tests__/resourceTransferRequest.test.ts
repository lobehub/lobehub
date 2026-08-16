// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const mockFindById = vi.fn();
const mockFindPendingByResource = vi.fn();
const mockListPendingForUser = vi.fn();
const mockCancel = vi.fn();
const mockDecline = vi.fn();
const mockInvalidate = vi.fn();

vi.mock('@/database/models/resourceTransferRequest', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ResourceTransferRequestModel: vi.fn(() => ({
      cancel: mockCancel,
      decline: mockDecline,
      findById: mockFindById,
      findPendingByResource: mockFindPendingByResource,
      invalidateForResources: mockInvalidate,
      listPendingForUser: mockListPendingForUser,
    })),
  };
});

const mockExecuteAcceptedTransfer = vi.fn();
vi.mock('@/server/services/resourceTransferRequest', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, executeAcceptedTransfer: mockExecuteAcceptedTransfer };
});

const mockStartJob = vi.fn();
vi.mock('@/business/server/agent-transfer/jobRunner', () => ({
  startAgentTransferJob: mockStartJob,
}));

const { TRANSFER_REQUEST_EXPIRED, TRANSFER_REQUEST_NOT_PENDING } =
  await import('@/database/models/resourceTransferRequest');
const { AGENT_OWNERSHIP_STALE } = await import('@/database/models/agent');
const { CHAT_GROUP_OWNERSHIP_STALE } = await import('@/database/models/chatGroup');
const { resourceTransferRequestRouter } = await import('../resourceTransferRequest');

const recipientId = 'user-recipient';
const initiatorId = 'user-initiator';

const pendingRequest = {
  id: 'req-1',
  initiatorId,
  options: null,
  previousOwnerId: initiatorId,
  recipientId,
  resourceId: 'agent-1',
  resourceType: 'agent' as const,
  status: 'pending' as const,
  workspaceId: 'ws-1',
};

describe('resourceTransferRequestRouter', () => {
  const ctx: any = { serverDB: {}, userId: recipientId, workspaceId: 'ws-1' };
  const caller = resourceTransferRequestRouter.createCaller(ctx);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects personal-mode calls', async () => {
    const personalCaller = resourceTransferRequestRouter.createCaller({
      serverDB: {},
      userId: recipientId,
      workspaceId: undefined,
    } as any);

    await expect(personalCaller.listMine()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  describe('accept', () => {
    it('executes the handover and kicks the backfill job', async () => {
      mockFindById.mockResolvedValue(pendingRequest);
      mockExecuteAcceptedTransfer.mockResolvedValue({ transferJobId: 'job-1' });

      const result = await caller.accept({ requestId: 'req-1' });

      expect(result).toEqual({ data: { transferJobId: 'job-1' }, success: true });
      expect(mockExecuteAcceptedTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId, request: pendingRequest, workspaceId: 'ws-1' }),
      );
      expect(mockStartJob).toHaveBeenCalledWith(expect.anything(), 'job-1');
    });

    it('hides requests addressed to someone else behind NOT_FOUND', async () => {
      mockFindById.mockResolvedValue({ ...pendingRequest, recipientId: 'someone-else' });

      await expect(caller.accept({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mockExecuteAcceptedTransfer).not.toHaveBeenCalled();
    });

    it('maps an expired request to BAD_REQUEST', async () => {
      mockFindById.mockResolvedValue(pendingRequest);
      mockExecuteAcceptedTransfer.mockRejectedValue(new Error(TRANSFER_REQUEST_EXPIRED));

      await expect(caller.accept({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('maps a raced resolution to CONFLICT', async () => {
      mockFindById.mockResolvedValue(pendingRequest);
      mockExecuteAcceptedTransfer.mockRejectedValue(new Error(TRANSFER_REQUEST_NOT_PENDING));

      await expect(caller.accept({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('retires the request when the agent changed since it was created', async () => {
      mockFindById.mockResolvedValue(pendingRequest);
      mockExecuteAcceptedTransfer.mockRejectedValue(new Error(AGENT_OWNERSHIP_STALE));

      await expect(caller.accept({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(mockInvalidate).toHaveBeenCalledWith('agent', ['agent-1']);
    });

    it('accepts a group request through the same execute path', async () => {
      const groupRequest = { ...pendingRequest, resourceId: 'group-1', resourceType: 'agentGroup' };
      mockFindById.mockResolvedValue(groupRequest);
      mockExecuteAcceptedTransfer.mockResolvedValue({ transferJobId: null });

      const result = await caller.accept({ requestId: 'req-1' });

      expect(result).toEqual({ data: { transferJobId: null }, success: true });
      expect(mockExecuteAcceptedTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ request: groupRequest }),
      );
      // No scope move on a group handover, so no backfill job to kick.
      expect(mockStartJob).not.toHaveBeenCalled();
    });

    it('retires the request when the group changed since it was created', async () => {
      mockFindById.mockResolvedValue({
        ...pendingRequest,
        resourceId: 'group-1',
        resourceType: 'agentGroup',
      });
      mockExecuteAcceptedTransfer.mockRejectedValue(new Error(CHAT_GROUP_OWNERSHIP_STALE));

      await expect(caller.accept({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(mockInvalidate).toHaveBeenCalledWith('agentGroup', ['group-1']);
    });
  });

  describe('decline / cancel', () => {
    it('decline resolves through the model as the recipient', async () => {
      mockDecline.mockResolvedValue({ ...pendingRequest, status: 'declined' });

      const result = await caller.decline({ requestId: 'req-1' });

      expect(mockDecline).toHaveBeenCalledWith('req-1', recipientId);
      expect(result.success).toBe(true);
    });

    it('cancel maps an already-resolved request to CONFLICT', async () => {
      mockCancel.mockRejectedValue(new Error(TRANSFER_REQUEST_NOT_PENDING));

      await expect(caller.cancel({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('maps an expired request to BAD_REQUEST on cancel and decline', async () => {
      mockCancel.mockRejectedValue(new Error(TRANSFER_REQUEST_EXPIRED));
      await expect(caller.cancel({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      mockDecline.mockRejectedValue(new Error(TRANSFER_REQUEST_EXPIRED));
      await expect(caller.decline({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('getPendingByResource', () => {
    it('returns null to viewers who are not a party to the request', async () => {
      mockFindPendingByResource.mockResolvedValue({
        ...pendingRequest,
        initiatorId: 'a',
        recipientId: 'b',
      });

      const result = await caller.getPendingByResource({
        resourceId: 'agent-1',
        resourceType: 'agent',
      });

      expect(result).toEqual({ data: null, success: true });
    });
  });

  describe('listMine', () => {
    it('returns an empty list untouched', async () => {
      mockListPendingForUser.mockResolvedValue([]);

      const result = await caller.listMine();

      expect(result).toEqual({ data: [], success: true });
      expect(mockListPendingForUser).toHaveBeenCalledWith(recipientId);
    });
  });
});
