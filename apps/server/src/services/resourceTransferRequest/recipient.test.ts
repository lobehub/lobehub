import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';
import { TransferErrorCode } from '@/types/transferError';

import { assertTransferRecipientValid } from './index';

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
