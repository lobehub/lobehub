import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

const commentAccess = vi.fn();
const canManage = vi.fn();
const hasAccessGrant = vi.fn();

vi.mock('@/server/routers/lambda/_helpers/acceptanceCommentAccess', () => ({
  resolveAcceptanceCommentAccess: (...args: unknown[]) => commentAccess(...args),
}));
vi.mock('@/database/models/acceptanceComment', () => ({
  AcceptanceCommentModel: class {
    hasAccessGrant = (...args: unknown[]) => hasAccessGrant(...args);
  },
}));
vi.mock('@/server/routers/lambda/_helpers/acceptanceWriteScope', () => ({
  canManageAcceptance: (...args: unknown[]) => canManage(...args),
}));

const db = {} as LobeChatDatabase;
const acceptance = { id: 'acc-1', userId: 'owner', workspaceId: null };

describe('resolveReviewAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the existing acceptance rules onto the review capabilities', async () => {
    commentAccess.mockResolvedValueOnce({ acceptance, canApprove: false, canComment: true });
    canManage.mockResolvedValueOnce(false);
    hasAccessGrant.mockResolvedValueOnce(false);
    const { resolveReviewAccess } = await import('./access');

    await expect(resolveReviewAccess(db, 'user-1', 'acc-1')).resolves.toEqual({
      acceptance,
      can: { comment: true, decide: false, moderate: false, reject: false },
    });
    expect(commentAccess).toHaveBeenCalledWith(db, 'user-1', 'acc-1');
    expect(canManage).toHaveBeenCalledWith({ serverDB: db, userId: 'user-1' }, acceptance);
  });

  it('lets a manager decide and moderate', async () => {
    commentAccess.mockResolvedValueOnce({ acceptance, canApprove: true, canComment: true });
    canManage.mockResolvedValueOnce(true);
    const { resolveReviewAccess } = await import('./access');

    await expect(resolveReviewAccess(db, 'owner', 'acc-1')).resolves.toMatchObject({
      can: { comment: true, decide: true, moderate: true, reject: true },
    });
    expect(hasAccessGrant).not.toHaveBeenCalled();
  });

  it('lets a reviewer granted reject access reject but not decide', async () => {
    commentAccess.mockResolvedValueOnce({ acceptance, canApprove: false, canComment: true });
    canManage.mockResolvedValueOnce(false);
    hasAccessGrant.mockResolvedValueOnce(true);
    const { resolveReviewAccess } = await import('./access');

    await expect(resolveReviewAccess(db, 'visitor', 'acc-1')).resolves.toMatchObject({
      can: { comment: true, decide: false, moderate: false, reject: true },
    });
    expect(hasAccessGrant).toHaveBeenCalledWith('acc-1', 'visitor', 'collaborate');
  });

  it('does not grant Send back on a site review through a collaboration grant', async () => {
    commentAccess.mockResolvedValueOnce({
      acceptance: { ...acceptance, subjectType: 'site' },
      canApprove: true,
      canComment: true,
    });
    canManage.mockResolvedValueOnce(false);
    hasAccessGrant.mockResolvedValueOnce(true);
    const { resolveReviewAccess } = await import('./access');

    await expect(resolveReviewAccess(db, 'owner', 'acc-1')).resolves.toMatchObject({
      can: { comment: true, decide: false, moderate: true, reject: false },
    });
  });

  it('reads an unreadable acceptance as none at all', async () => {
    commentAccess.mockRejectedValueOnce(new TRPCError({ code: 'NOT_FOUND' }));
    const { resolveReviewAccess } = await import('./access');

    await expect(resolveReviewAccess(db, 'stranger', 'acc-1')).resolves.toBeNull();
  });

  it('lets unexpected failures through', async () => {
    commentAccess.mockRejectedValueOnce(new Error('db down'));
    const { resolveReviewAccess } = await import('./access');

    await expect(resolveReviewAccess(db, 'user-1', 'acc-1')).rejects.toThrow('db down');
  });
});
