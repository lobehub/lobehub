import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';
import { TransferErrorCode } from '@/types/transferError';

import { assertTransferRecipientValid, executeAcceptedTransfer } from './index';

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(),
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

  it('refuses acceptance when the recipient was downgraded to viewer during the pending window', async () => {
    getMember.mockResolvedValue({ role: 'viewer' });

    await expect(
      executeAcceptedTransfer({
        db: {} as LobeChatDatabase,
        recipientId: 'recipient-1',
        request,
        workspaceId: 'ws-1',
      }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
    });
  });

  it('refuses acceptance when the recipient left the workspace during the pending window', async () => {
    getMember.mockResolvedValue(undefined);

    await expect(
      executeAcceptedTransfer({
        db: {} as LobeChatDatabase,
        recipientId: 'recipient-1',
        request,
        workspaceId: 'ws-1',
      }),
    ).rejects.toMatchObject({
      cause: { data: { code: TransferErrorCode.TargetNotWorkspaceMember } },
    });
  });
});
