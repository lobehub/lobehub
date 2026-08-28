import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';
import { TransferErrorCode } from '@/types/transferError';

import { assertTransferRecipientValid, executeAcceptedTransfer } from './index';

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(),
}));

const assertCanPerformResourceAction = vi.fn();
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: (...args: unknown[]) => assertCanPerformResourceAction(...args),
}));

const getMember = vi.fn();

const baseParams = {
  currentOwnerId: 'owner-1',
  db: {} as LobeChatDatabase,
  initiatorId: 'initiator-1',
  recipientId: 'recipient-1',
  workspaceId: 'ws-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(WorkspaceMemberModel).mockImplementation(() => ({ getMember }) as any);
});

describe('assertTransferRecipientValid', () => {
  it('accepts an active member with write capability', async () => {
    getMember.mockResolvedValue({ role: 'member' });

    await expect(assertTransferRecipientValid(baseParams)).resolves.toBeUndefined();
  });

  it('rejects the initiator or current owner as recipient', async () => {
    await expect(
      assertTransferRecipientValid({ ...baseParams, recipientId: 'initiator-1' }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TargetIsCurrentOwner } },
    });
    expect(getMember).not.toHaveBeenCalled();
  });

  it('rejects a non-member recipient', async () => {
    getMember.mockResolvedValue(undefined);

    await expect(assertTransferRecipientValid(baseParams)).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TargetNotWorkspaceMember } },
    });
  });

  it('rejects a viewer: ownership would strand the resource with someone who cannot edit it', async () => {
    getMember.mockResolvedValue({ role: 'viewer' });

    await expect(assertTransferRecipientValid(baseParams)).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
    });
  });
});

describe('executeAcceptedTransfer recipient recheck', () => {
  const request = {
    id: 'req-1',
    initiatorId: 'initiator-1',
    options: null,
    previousOwnerId: 'owner-1',
    recipientId: 'recipient-1',
    resourceId: 'agent-1',
    resourceType: 'agent',
    status: 'pending',
    workspaceId: 'ws-1',
  } as any;

  // The recheck runs inside db.transaction with the membership row locked
  // (`FOR UPDATE`); the mock replays that select chain with a canned row set.
  const dbWithLockedMemberRows = (rows: { role: string }[]) =>
    ({
      transaction: (cb: (trx: unknown) => Promise<unknown>) =>
        cb({
          select: () => ({
            from: () => ({
              where: () => ({ for: () => Promise.resolve(rows) }),
            }),
          }),
        }),
    }) as unknown as LobeChatDatabase;

  it('refuses acceptance when the recipient was downgraded to viewer during the pending window', async () => {
    await expect(
      executeAcceptedTransfer({
        db: dbWithLockedMemberRows([{ role: 'viewer' }]),
        recipientId: 'recipient-1',
        request,
        workspaceId: 'ws-1',
      }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
    });
  });

  it('refuses acceptance when the recipient left the workspace during the pending window', async () => {
    await expect(
      executeAcceptedTransfer({
        db: dbWithLockedMemberRows([]),
        recipientId: 'recipient-1',
        request,
        workspaceId: 'ws-1',
      }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TargetNotWorkspaceMember } },
    });
  });

  it("refuses a reassignment accept when the initiator's transfer authority was revoked", async () => {
    assertCanPerformResourceAction.mockRejectedValue(
      new TRPCError({ code: 'FORBIDDEN', message: 'no longer primary owner' }),
    );

    await expect(
      executeAcceptedTransfer({
        db: dbWithLockedMemberRows([{ role: 'member' }]),
        recipientId: 'recipient-1',
        request, // previousOwnerId !== initiatorId → reassignment
        workspaceId: 'ws-1',
      }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TransferRequestStale } },
    });
    expect(assertCanPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer', userId: 'initiator-1' }),
    );
  });

  it('propagates transient authority-check failures instead of mapping them to stale', async () => {
    assertCanPerformResourceAction.mockRejectedValue(new Error('connection reset'));

    await expect(
      executeAcceptedTransfer({
        db: dbWithLockedMemberRows([{ role: 'member' }]),
        recipientId: 'recipient-1',
        request,
        workspaceId: 'ws-1',
      }),
    ).rejects.toThrow('connection reset');
  });

  it('refuses a reassignment accept when the initiator account was deleted', async () => {
    await expect(
      executeAcceptedTransfer({
        db: dbWithLockedMemberRows([{ role: 'member' }]),
        recipientId: 'recipient-1',
        request: { ...request, initiatorId: null },
        workspaceId: 'ws-1',
      }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TransferRequestStale } },
    });
  });
});
