// @vitest-environment node
import { TRPCError } from '@trpc/server';
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
const mockInvalidateRequest = vi.fn();

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
      invalidateRequest: mockInvalidateRequest,
      listPendingForUser: mockListPendingForUser,
    })),
  };
});

const mockExecuteAcceptedTransfer = vi.fn();
vi.mock('@/server/services/resourceTransferRequest', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, executeAcceptedTransfer: mockExecuteAcceptedTransfer };
});

const mockBuildManifest = vi.fn();
vi.mock('@/database/repositories/resourceTransferManifest', () => ({
  buildMemberTransferManifest: (...args: unknown[]) => mockBuildManifest(...args),
}));

const mockAssertTransferAuthority = vi.fn();
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: (...args: unknown[]) => mockAssertTransferAuthority(...args),
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
    it('executes the handover', async () => {
      mockFindById.mockResolvedValue(pendingRequest);
      mockExecuteAcceptedTransfer.mockResolvedValue(undefined);

      const result = await caller.accept({ requestId: 'req-1' });

      expect(result).toEqual({ data: null, success: true });
      expect(mockExecuteAcceptedTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId, request: pendingRequest, workspaceId: 'ws-1' }),
      );
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

    it('maps a lazily-expired row to BAD_REQUEST before executing', async () => {
      // `findById` stamps an overdue pending row `expired` and returns it as
      // such — the router must surface the expiration outcome, not push on
      // into the accept (which would report the misleading "already
      // resolved" conflict).
      mockFindById.mockResolvedValue({ ...pendingRequest, status: 'expired' });

      await expect(caller.accept({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(mockExecuteAcceptedTransfer).not.toHaveBeenCalled();
    });

    it('maps a raced resolution to CONFLICT', async () => {
      mockFindById.mockResolvedValue(pendingRequest);
      mockExecuteAcceptedTransfer.mockRejectedValue(new Error(TRANSFER_REQUEST_NOT_PENDING));

      await expect(caller.accept({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('retires the request when the initiator authority went stale', async () => {
      mockFindById.mockResolvedValue(pendingRequest);
      mockExecuteAcceptedTransfer.mockRejectedValue(
        new TRPCError({
          cause: { data: { code: 'TRANSFER_REQUEST_STALE' } },
          code: 'BAD_REQUEST',
          message: "The initiator's authority changed since this request was created",
        }),
      );

      await expect(caller.accept({ requestId: 'req-1' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      // A permanently unfulfillable request must not keep rendering until
      // expiry — but only THIS request retires; a racing replacement survives.
      expect(mockInvalidateRequest).toHaveBeenCalledWith('req-1');
      expect(mockInvalidate).not.toHaveBeenCalled();
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
      mockExecuteAcceptedTransfer.mockResolvedValue(undefined);

      const result = await caller.accept({ requestId: 'req-1' });

      expect(result).toEqual({ data: null, success: true });
      expect(mockExecuteAcceptedTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ request: groupRequest }),
      );
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

  describe('getTransferManifest', () => {
    const manifest = {
      botPlatforms: ['discord'],
      cronJobs: 1,
      deviceBindingAffected: false,
      hiddenReferencedMember: false,
      ownerId: initiatorId,
      tasksToDetach: 0,
    };

    it('lets the recipient of the live request see the manifest without transfer authority', async () => {
      mockFindPendingByResource.mockResolvedValue(pendingRequest);
      mockBuildManifest.mockResolvedValue(manifest);

      const result = await caller.getTransferManifest({
        recipientId,
        resourceId: 'agent-1',
        resourceType: 'agent',
      });

      expect(result).toEqual({ data: manifest, success: true });
      expect(mockAssertTransferAuthority).not.toHaveBeenCalled();
    });

    it('pins a party read to the pending request’s recipient, ignoring the supplied id', async () => {
      mockFindPendingByResource.mockResolvedValue(pendingRequest);
      mockBuildManifest.mockResolvedValue(manifest);

      await caller.getTransferManifest({
        recipientId: 'probed-member', // caller-controlled — must NOT reach the computation
        resourceId: 'agent-1',
        resourceType: 'agent',
      });

      expect(mockBuildManifest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientId }),
      );
    });

    it('rechecks transfer authority for the INITIATOR of the live request', async () => {
      // A role downgrade after filing the request must not leave the
      // initiator a week-long window to keep reading attachment metadata.
      mockFindPendingByResource.mockResolvedValue({
        ...pendingRequest,
        initiatorId: recipientId, // the caller
        recipientId: 'someone-else',
      });
      mockAssertTransferAuthority.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'no' }),
      );

      await expect(
        caller.getTransferManifest({
          recipientId: 'probed-member',
          resourceId: 'agent-1',
          resourceType: 'agent',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockBuildManifest).not.toHaveBeenCalled();
    });

    it('pins an authorized initiator read to the pending request’s recipient', async () => {
      mockFindPendingByResource.mockResolvedValue({
        ...pendingRequest,
        initiatorId: recipientId, // the caller
        recipientId: 'someone-else',
      });
      mockAssertTransferAuthority.mockResolvedValue(undefined);
      mockBuildManifest.mockResolvedValue(manifest);

      await caller.getTransferManifest({
        recipientId: 'probed-member', // caller-controlled — must NOT reach the computation
        resourceId: 'agent-1',
        resourceType: 'agent',
      });

      expect(mockAssertTransferAuthority).toHaveBeenCalled();
      expect(mockBuildManifest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientId: 'someone-else' }),
      );
    });

    it('requires transfer authority when the caller is not a party', async () => {
      mockFindPendingByResource.mockResolvedValue(undefined);
      mockAssertTransferAuthority.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'no' }),
      );

      await expect(
        caller.getTransferManifest({
          recipientId,
          resourceId: 'agent-1',
          resourceType: 'agent',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockBuildManifest).not.toHaveBeenCalled();
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
