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
// Minimal stub: answers the builtin-marker and group-membership lookups with
// "nothing found", which is the ordinary case.
const emptyQueryDb = (rows: unknown[] = []) =>
  ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
  }) as unknown as LobeChatDatabase;
const db = emptyQueryDb();
// `slug: null` = an ordinary agent, stated explicitly so the evaluator has no
// reason to resolve it from the database.
const meta = {
  slug: null,
  userId: 'creator',
  virtual: false,
  visibility: 'public',
  workspaceId: 'ws-1',
};

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

  // LOBE-12374: workspace-level builtin agents (Lobe AI inbox, the builders) are
  // created lazily by whoever opens the workspace first, so their `user_id` is an
  // accident of timing and they never get a `resource_permissions` row. Members
  // must still be able to configure them.
  describe('builtin workspace agents', () => {
    const builtinMeta = {
      slug: 'agent-builder',
      userId: 'someone-else',
      // provisioning always writes `virtual: true`
      virtual: true,
      visibility: 'public',
      workspaceId: 'ws-1',
    };

    it.each(['manage', 'edit', 'use', 'view'] as const)(
      'lets a member %s a builtin workspace agent created by someone else',
      async (action) => {
        permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
        effectiveAccessMock.mockResolvedValue('use');

        await expect(
          canPerformResourceAction({
            action,
            db,
            meta: builtinMeta,
            resourceId: 'agent-builder-1',
            resourceType: 'agent',
            userId: 'member',
            workspaceId: 'ws-1',
          }),
        ).resolves.toBe(true);
      },
    );

    it('keeps deleting a builtin workspace agent out of a member’s reach', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'delete',
          db,
          meta: builtinMeta,
          resourceId: 'agent-builder-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    it('still rejects a viewer, who holds no agent:update capability at all', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: false });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db,
          meta: builtinMeta,
          resourceId: 'agent-builder-1',
          resourceType: 'agent',
          userId: 'viewer',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    it.each(['inbox', 'agent-builder', 'group-agent-builder', 'page-agent'])(
      'covers the %s collaborative builtin slug',
      async (slug) => {
        permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
        effectiveAccessMock.mockResolvedValue('use');

        await expect(
          canPerformResourceAction({
            action: 'edit',
            db,
            meta: { ...builtinMeta, slug },
            resourceId: 'builtin-1',
            resourceType: 'agent',
            userId: 'member',
            workspaceId: 'ws-1',
          }),
        ).resolves.toBe(true);
      },
    );

    // Internal automation agents have no configuration surface, so a member must
    // not be able to repoint their model and break background jobs workspace-wide.
    it.each([
      'nightly-review',
      'self-reflection',
      'self-feedback-intent',
      'skill-management',
      'verify-agent',
      'task-agent',
      'group-supervisor',
      'onboarding-understanding',
    ])('keeps the %s internal builtin out of the bypass', async (slug) => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db,
          meta: { ...builtinMeta, slug },
          resourceId: 'builtin-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    it('still lets every member use an internal builtin (resource default is use)', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'use',
          db,
          meta: { ...builtinMeta, slug: 'nightly-review' },
          resourceId: 'builtin-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);
    });

    it('never treats an agentGroup as builtin, even with a builtin-looking slug', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db,
          meta: { ...builtinMeta, slug: 'inbox' },
          resourceId: 'group-1',
          resourceType: 'agentGroup',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    it('does not treat a personal (workspace-less) builtin agent as workspace-managed', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db,
          // `meta.workspaceId` must match the caller's workspace to get this far,
          // so a null-workspace row is rejected earlier; assert the guard anyway.
          meta: { ...builtinMeta, workspaceId: null },
          resourceId: 'builtin-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    // The agent-run path hand-builds `meta` from a config it already loaded, so a
    // missing slug must be resolved rather than silently downgrading the row —
    // otherwise execution classifies a member differently from configuration.
    it('resolves a missing slug instead of misclassifying the row', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');
      let call = 0;
      const dbWithSlug = {
        select: () => ({
          from: () => ({
            where: () => ({
              // 1st query resolves the builtin markers, 2nd checks group membership
              limit: async () => (call++ === 0 ? [{ slug: 'agent-builder', virtual: true }] : []),
            }),
          }),
        }),
      } as unknown as LobeChatDatabase;

      await expect(
        canPerformResourceAction({
          action: 'manage',
          db: dbWithSlug,
          // markers absent entirely, as a hand-built meta leaves them
          meta: { userId: 'someone-else', visibility: 'public', workspaceId: 'ws-1' },
          resourceId: 'agent-builder-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);
    });

    // Legacy rows could hold a reserved slug (the passthrough config endpoint used
    // to allow it), so the slug alone must not grant the bypass.
    it('does not bypass for a non-provisioned row holding a reserved slug', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'manage',
          db,
          meta: { ...builtinMeta, virtual: false },
          resourceId: 'squatter-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    // Group members were historically created from caller payloads carrying
    // `virtual: true` and (before the slug guard) a reserved slug, so a legacy
    // collision must not inherit the bypass.
    it('does not bypass for a group member holding a reserved slug', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'manage',
          db: emptyQueryDb([{ agentId: 'group-member-1' }]),
          meta: builtinMeta,
          resourceId: 'group-member-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    it('does not re-fetch when the caller passed an explicit null slug', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');
      // An explicit `slug: null` is an ordinary agent, so the evaluator must not
      // resolve markers — and never reaches the membership check either.
      const dbThatWouldThrow = {
        select: () => {
          throw new Error('should not query when the markers are explicit');
        },
      } as unknown as LobeChatDatabase;

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db: dbThatWouldThrow,
          meta: {
            slug: null,
            userId: 'someone-else',
            virtual: false,
            visibility: 'public',
            workspaceId: 'ws-1',
          },
          resourceId: 'agent-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    it('does not treat an ordinary agent whose slug is user-generated as builtin', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db,
          meta: { ...builtinMeta, slug: 'religious-having-instrument' },
          resourceId: 'agent-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });
  });
});
