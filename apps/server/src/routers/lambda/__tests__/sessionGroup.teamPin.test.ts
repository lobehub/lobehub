// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionGroupModel } from '@/database/models/sessionGroup';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

import { sessionGroupRouter } from '../sessionGroup';

vi.mock('@/database/models/sessionGroup', () => ({ SessionGroupModel: vi.fn() }));
vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: vi.fn(),
}));
vi.mock('@/server/services/workspacePermission', () => ({
  getWorkspaceScopedPermissionMatches: vi.fn(),
  hasWorkspaceScopedPermission: vi.fn(),
  isWorkspacePrimaryOwner: vi.fn(),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));

const userId = 'member-1';
const matches = vi.mocked(getWorkspaceScopedPermissionMatches);

describe('sessionGroupRouter.updateSessionGroupTeamPinned', () => {
  let model: { updateTeamPinned: ReturnType<typeof vi.fn> };
  const ctx = { userId, workspaceId: 'ws-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    model = { updateTeamPinned: vi.fn().mockResolvedValue(true) };
    vi.mocked(SessionGroupModel).mockImplementation(function () {
      return model as never;
    });
  });

  it('refuses a member without the all-resource agent update grant', async () => {
    matches.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });

    await expect(
      sessionGroupRouter
        .createCaller(ctx as never)
        .updateSessionGroupTeamPinned({ id: 'sg-1', pinned: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(model.updateTeamPinned).not.toHaveBeenCalled();
  });

  it('lets an owner/admin pin a public folder for the team', async () => {
    matches.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });

    await sessionGroupRouter
      .createCaller(ctx as never)
      .updateSessionGroupTeamPinned({ id: 'sg-1', pinned: true });

    expect(matches).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AGENT_UPDATE', userId, workspaceId: 'ws-1' }),
    );
    expect(model.updateTeamPinned).toHaveBeenCalledWith('sg-1', true);
  });

  it('reports a folder that cannot carry a team pin', async () => {
    matches.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
    model.updateTeamPinned.mockResolvedValue(false);

    await expect(
      sessionGroupRouter
        .createCaller(ctx as never)
        .updateSessionGroupTeamPinned({ id: 'private-sg', pinned: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects personal mode, where folders have no team pin', async () => {
    await expect(
      sessionGroupRouter
        .createCaller({ userId } as never)
        .updateSessionGroupTeamPinned({ id: 'sg-1', pinned: true }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(matches).not.toHaveBeenCalled();
  });
});
