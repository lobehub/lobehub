// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import {
  getWorkspaceScopedPermissionMatches,
  isWorkspacePrimaryOwner,
  resolveWorkspaceGrantedPermissions,
} from '@/server/services/workspacePermission';

import { canPerformResourceAction, isResourceAuthorOrAdmin } from './index';

const effectiveAccessMock = vi.hoisted(() => vi.fn());
// The *explicit* level (null when the resource has no `resource_permissions` row)
// is what decides whether a collaborative builtin bypasses the default.
const explicitAccessMock = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: class {
    getAccessLevel = explicitAccessMock;
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
    explicitAccessMock.mockResolvedValue(null);
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

  it('uses a pre-resolved effective access level without querying it again', async () => {
    permissionMatchesMock
      .mockResolvedValueOnce({ hasAllScope: true, hasOwnerScope: false })
      .mockResolvedValueOnce({ hasAllScope: false, hasOwnerScope: true });

    await expect(
      canPerformResourceAction({
        action: 'view',
        db,
        effectiveAccessLevel: 'view',
        grantedPermissions: ['agent:read:all'],
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'member',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(true);
    expect(effectiveAccessMock).not.toHaveBeenCalled();
  });

  it('does not let pre-resolved levels bypass General access for stronger actions', async () => {
    permissionMatchesMock
      .mockResolvedValueOnce({ hasAllScope: true, hasOwnerScope: false })
      .mockResolvedValueOnce({ hasAllScope: false, hasOwnerScope: true });
    effectiveAccessMock.mockResolvedValue('view');

    await expect(
      canPerformResourceAction({
        action: 'use',
        db,
        effectiveAccessLevel: 'edit',
        grantedPermissions: ['ai_model:invoke:all'],
        meta,
        resourceId: 'agent-1',
        resourceType: 'agent',
        userId: 'member',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(false);
    expect(effectiveAccessMock).toHaveBeenCalledTimes(1);
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

  // workspace-level builtin agents (Lobe AI inbox, the builders) are
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

    it.each(['edit', 'use', 'view'] as const)(
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

    // `manage` authorizes ACL writes (`setGeneralAccess`) and, on the client, whether
    // model/mode/device picks mutate the shared row. A member holding it could persist
    // an explicit `use` level and lock everyone else out again.
    it('keeps manage out of a member’s reach on a collaborative builtin', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'manage',
          db,
          meta: builtinMeta,
          resourceId: 'agent-builder-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

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

    it('still lets every member use an internal builtin at use-level access', async () => {
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
          action: 'edit',
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

    // Linking the real inbox into an agent group is supported, so a linked builtin
    // must keep the bypass — excluding group members would reproduce for
    // that workspace.
    it('keeps the bypass for a builtin that is linked into an agent group', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db: emptyQueryDb([{ agentId: 'inbox-1' }]),
          meta: { ...builtinMeta, slug: 'inbox' },
          resourceId: 'inbox-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);
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

    // Configuration and execution ask different questions of the same row: a
    // member may configure a collaborative builtin, but the run must still honor
    // that member's own model / device / mode overrides.
    it('separates configuration authority from author/admin execution management', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db,
          meta: builtinMeta,
          resourceId: 'agent-builder-1',
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);

      await expect(
        isResourceAuthorOrAdmin({
          db,
          meta: builtinMeta,
          resourceType: 'agent',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);
    });

    it('still reports author and admin as execution managers', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });

      await expect(
        isResourceAuthorOrAdmin({
          db,
          meta: builtinMeta,
          resourceType: 'agent',
          userId: 'someone-else',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);

      await expect(
        isResourceAuthorOrAdmin({
          db,
          meta: builtinMeta,
          resourceType: 'agent',
          userId: 'workspace-admin',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);
    });

    // The bypass covers the *implicit* resource default only. An owner who explicitly
    // narrows General access means it — otherwise that control would persist a value
    // it never enforces.
    it('enforces an explicitly configured access level on a collaborative builtin', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
      explicitAccessMock.mockResolvedValue('view');
      effectiveAccessMock.mockResolvedValue('view');

      await expect(
        canPerformResourceAction({
          action: 'edit',
          db,
          meta: builtinMeta,
          resourceId: 'agent-builder-1',
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

  // Knowledge bases invert the usual ordering: browsing the internal file list
  // ('view') is the privileged act and requires the `edit` grade, while `use`
  // keeps the KB mountable for retrieval.
  describe('knowledge bases', () => {
    const kbMeta = {
      userId: 'creator',
      visibility: 'public',
      workspaceId: 'ws-1',
    };

    // Members hold `knowledge_base:read:all` (the capability ceiling for
    // 'view') but only `:owner` on update, so the resource-admin bypass check
    // must not fire for them.
    const memberMatches = ({ action }: { action: string }) =>
      Promise.resolve(
        action === 'KNOWLEDGE_BASE_UPDATE'
          ? { hasAllScope: false, hasOwnerScope: true }
          : { hasAllScope: true, hasOwnerScope: false },
      );

    it('lets a member browse a KB at the default edit level', async () => {
      permissionMatchesMock.mockImplementation(memberMatches as any);
      effectiveAccessMock.mockResolvedValue('edit');

      await expect(
        canPerformResourceAction({
          action: 'view',
          db,
          meta: kbMeta,
          resourceId: 'kb-1',
          resourceType: 'knowledgeBase',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);
    });

    it('blocks a member from browsing a use-level KB while keeping it usable', async () => {
      permissionMatchesMock.mockImplementation(memberMatches as any);
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'view',
          db,
          meta: kbMeta,
          resourceId: 'kb-1',
          resourceType: 'knowledgeBase',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(false);

      await expect(
        canPerformResourceAction({
          action: 'use',
          db,
          meta: kbMeta,
          resourceId: 'kb-1',
          resourceType: 'knowledgeBase',
          userId: 'member',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);
    });

    it('lets a KNOWLEDGE_BASE_UPDATE:all curator browse a use-level KB', async () => {
      permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'view',
          db,
          meta: kbMeta,
          resourceId: 'kb-1',
          resourceType: 'knowledgeBase',
          userId: 'workspace-admin',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);
      expect(effectiveAccessMock).not.toHaveBeenCalled();
    });

    it('lets the creator browse their own use-level KB', async () => {
      permissionMatchesMock.mockImplementation(memberMatches as any);
      effectiveAccessMock.mockResolvedValue('use');

      await expect(
        canPerformResourceAction({
          action: 'view',
          db,
          meta: kbMeta,
          resourceId: 'kb-1',
          resourceType: 'knowledgeBase',
          userId: 'creator',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBe(true);
      expect(effectiveAccessMock).not.toHaveBeenCalled();
    });
  });
});
