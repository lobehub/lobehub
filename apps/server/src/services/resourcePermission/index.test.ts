// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import {
  getWorkspaceScopedPermissionMatches,
  isWorkspacePrimaryOwner,
  resolveWorkspaceGrantedPermissions,
} from '@/server/services/workspacePermission';

import { canPerformResourceAction } from './index';

const effectiveAccessMock = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: class {
    getEffectiveAccessLevel = effectiveAccessMock;
  },
}));

vi.mock('@/server/services/workspacePermission', () => ({
  getWorkspaceScopedPermissionMatches: vi.fn(),
  isWorkspacePrimaryOwner: vi.fn(),
  resolveWorkspaceGrantedPermissions: vi.fn(),
}));

const permissionMatchesMock = vi.mocked(getWorkspaceScopedPermissionMatches);
const primaryOwnerMock = vi.mocked(isWorkspacePrimaryOwner);
const resolveGrantsMock = vi.mocked(resolveWorkspaceGrantedPermissions);
const db = {} as LobeChatDatabase;
const meta = { userId: 'creator', visibility: 'public', workspaceId: 'ws-1' };

describe('canPerformResourceAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveGrantsMock.mockResolvedValue(['ai_model:invoke:all']);
  });

  it('lets a Workspace admin bypass view-only Member Permissions', async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
    effectiveAccessMock.mockResolvedValue('view');

    await expect(
      canPerformResourceAction({
        action: 'use',
        db,
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'workspace-admin',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(true);
    expect(effectiveAccessMock).not.toHaveBeenCalled();
  });

  it('lets the Agent author bypass view-only Member Permissions', async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
    effectiveAccessMock.mockResolvedValue('view');

    await expect(
      canPerformResourceAction({
        action: 'edit',
        db,
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'creator',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(true);
    expect(effectiveAccessMock).not.toHaveBeenCalled();
  });

  it('lets the creator transfer their own agent', async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });

    await expect(
      canPerformResourceAction({
        action: 'transfer',
        db,
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'creator',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(true);
    expect(primaryOwnerMock).not.toHaveBeenCalled();
  });

  it('lets the primary owner transfer a shared agent created by someone else', async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
    primaryOwnerMock.mockResolvedValue(true);

    await expect(
      canPerformResourceAction({
        action: 'transfer',
        db,
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'primary-owner',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(true);
  });

  it("rejects a co-admin transferring another member's shared agent", async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
    primaryOwnerMock.mockResolvedValue(false);

    await expect(
      canPerformResourceAction({
        action: 'transfer',
        db,
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'workspace-admin',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(false);
  });

  it("rejects the primary owner transferring another member's private agent", async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
    primaryOwnerMock.mockResolvedValue(true);

    await expect(
      canPerformResourceAction({
        action: 'transfer',
        db,
        meta: { ...meta, visibility: 'private' },
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'primary-owner',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(false);
    expect(primaryOwnerMock).not.toHaveBeenCalled();
  });

  it('keeps changeVisibility creator-only even for the primary owner', async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
    primaryOwnerMock.mockResolvedValue(true);

    await expect(
      canPerformResourceAction({
        action: 'changeVisibility',
        db,
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'primary-owner',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(false);
  });

  it('still applies the resource level when an ordinary member can invoke all agents', async () => {
    permissionMatchesMock
      .mockResolvedValueOnce({ hasAllScope: true, hasOwnerScope: false })
      .mockResolvedValueOnce({ hasAllScope: false, hasOwnerScope: true });
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
    expect(permissionMatchesMock.mock.calls.map(([input]) => input.action)).toEqual([
      'AI_MODEL_INVOKE',
      'AGENT_UPDATE',
    ]);
  });

  it('reads the caller grants once even when two actions are matched', async () => {
    permissionMatchesMock
      .mockResolvedValueOnce({ hasAllScope: true, hasOwnerScope: false })
      .mockResolvedValueOnce({ hasAllScope: false, hasOwnerScope: true });
    effectiveAccessMock.mockResolvedValue('view');

    await canPerformResourceAction({
      action: 'use',
      db,
      meta,
      resourceId: 'agent-1',
      resourceType: 'agent',
      userId: 'member',
      workspaceId: 'ws-1',
    });

    expect(resolveGrantsMock).toHaveBeenCalledTimes(1);
    expect(permissionMatchesMock.mock.calls.map(([input]) => input.grantedPermissions)).toEqual([
      ['ai_model:invoke:all'],
      ['ai_model:invoke:all'],
    ]);
  });
});
