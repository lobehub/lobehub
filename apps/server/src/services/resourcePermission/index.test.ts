// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

import { canPerformResourceAction } from './index';

const effectiveAccessMock = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: class {
    getEffectiveAccessLevel = effectiveAccessMock;
  },
}));

vi.mock('@/server/services/workspacePermission', () => ({
  getWorkspaceScopedPermissionMatches: vi.fn(),
}));

const permissionMatchesMock = vi.mocked(getWorkspaceScopedPermissionMatches);
const db = {} as LobeChatDatabase;
const meta = { userId: 'creator', visibility: 'public', workspaceId: 'ws-1' };

describe('canPerformResourceAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets an action-specific all-scope grant override a view-only resource', async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
    effectiveAccessMock.mockResolvedValue('view');

    await expect(
      canPerformResourceAction({
        action: 'use',
        db,
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'workspace-owner',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(true);
    expect(effectiveAccessMock).not.toHaveBeenCalled();
  });

  it('still applies the resource level to an ordinary member', async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
    effectiveAccessMock.mockResolvedValue('view');

    await expect(
      canPerformResourceAction({
        action: 'use',
        db,
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'member',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(false);
  });
});
