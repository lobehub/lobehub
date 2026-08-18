import type { WorkspaceApiKeyMemberCreation } from '@lobechat/types';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';

import {
  type NewWorkspace,
  type WorkspaceItem,
  workspaceMembers,
  workspaces,
} from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';
import { AGENT_TRANSFER_PENDING_OWNER_DELETE, AgentTransferJobModel } from './agentTransferJob';

export const getActiveWorkspaceMembershipRole = async (
  db: LobeChatDatabase,
  params: { userId: string; workspaceId: string },
): Promise<string | null> => {
  const [row] = await db
    .select({ primaryOwnerId: workspaces.primaryOwnerId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, params.workspaceId),
        eq(workspaceMembers.userId, params.userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Owner is bound to `workspaces.primaryOwnerId`; un-converged legacy
  // co-owner labels count as Admin.
  if (row.role === 'owner' && row.primaryOwnerId !== params.userId) return 'admin';
  return row.role;
};

/**
 * Whether `userId` currently holds owner status in `workspaceId`.
 * `workspace_members.role` is the single source of truth for built-in roles
 *. Used by the workspace-API-key owner gates on both the OpenAPI
 * and lambda TRPC surfaces.
 */
export const hasWorkspaceOwnerAccess = async (
  db: LobeChatDatabase,
  params: { userId: string; workspaceId: string },
): Promise<boolean> => {
  return (await getActiveWorkspaceMembershipRole(db, params)) === 'owner';
};

/**
 * Whether a member may administer workspace-level shared configuration. Owner
 * and Admin pass; Member and Viewer do not.
 */
export const hasWorkspaceAdminAccess = async (
  db: LobeChatDatabase,
  params: { userId: string; workspaceId: string },
): Promise<boolean> => {
  const role = await getActiveWorkspaceMembershipRole(db, params);
  return role === 'owner' || role === 'admin';
};

export const hasActiveWorkspaceMembership = async (
  db: LobeChatDatabase,
  params: { userId: string; workspaceId: string },
): Promise<boolean> => {
  return (await getActiveWorkspaceMembershipRole(db, params)) !== null;
};

export const getWorkspaceApiKeyMemberCreation = (
  settings: unknown,
): WorkspaceApiKeyMemberCreation => {
  if (!settings || typeof settings !== 'object') return 'all_members';

  const apiKey = (settings as { apiKey?: unknown }).apiKey;
  if (!apiKey || typeof apiKey !== 'object') return 'all_members';

  return (apiKey as { memberCreation?: unknown }).memberCreation === 'admins_only'
    ? 'admins_only'
    : 'all_members';
};

export class WorkspaceModel {
  protected readonly db: LobeChatDatabase;
  protected readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (params: {
    avatar?: string;
    description?: string;
    name: string;
    slug: string;
  }) => {
    return this.db.transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({
          avatar: params.avatar,
          description: params.description,
          name: params.name,
          primaryOwnerId: this.userId,
          slug: params.slug,
        } satisfies NewWorkspace)
        .returning();

      // `workspace_members.role` is the single source of truth for built-in
      // workspace roles — no RBAC rows are seeded per workspace.
      await tx.insert(workspaceMembers).values({
        role: 'owner',
        userId: this.userId,
        workspaceId: workspace.id,
      });

      return workspace;
    });
  };

  delete = async (id: string) => {
    // See UserModel.deleteUser: while an agent-TRANSFER backfill still points
    // at this workspace (as source or target), unmigrated message snapshots
    // would be cascade-deleted with it. Reject and let the caller retry after
    // the job drains. Pending `copy` jobs do not block — see
    // `isPendingTransfer` in agentTransferJob.ts.
    if (await AgentTransferJobModel.hasPendingJobTouchingWorkspace(this.db, id)) {
      throw new Error(AGENT_TRANSFER_PENDING_OWNER_DELETE);
    }
    return this.db
      .delete(workspaces)
      .where(and(eq(workspaces.id, id), eq(workspaces.primaryOwnerId, this.userId)));
  };

  findById = async (id: string) => {
    return this.db.query.workspaces.findFirst({
      where: eq(workspaces.id, id),
    });
  };

  findBySlug = async (slug: string) => {
    return this.db.query.workspaces.findFirst({
      where: eq(workspaces.slug, slug),
    });
  };

  /**
   * List ids of workspaces where this user is the primary (Stripe-bound) owner.
   * Cloud callers combine with subscription-status data to enforce the Free
   * workspace cap; OSS callers can use the raw count.
   */
  listOwnedWorkspaceIds = async (): Promise<string[]> => {
    const owned = await this.db.query.workspaces.findMany({
      columns: { id: true },
      where: eq(workspaces.primaryOwnerId, this.userId),
    });
    return owned.map((w) => w.id);
  };

  getSettings = async (id: string) => {
    const workspace = await this.db.query.workspaces.findFirst({
      columns: { settings: true },
      where: eq(workspaces.id, id),
    });
    return workspace?.settings ?? {};
  };

  getApiKeyMemberCreation = async (id: string): Promise<WorkspaceApiKeyMemberCreation> => {
    return getWorkspaceApiKeyMemberCreation(await this.getSettings(id));
  };

  /**
   * Count every workspace this user belongs to — owned + joined. Reads the
   * membership table directly because owners are always inserted as members on
   * `create`, so a single count covers both shapes.
   */
  countUserMemberships = async (): Promise<number> => {
    const result = await this.db
      .select({ count: count() })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, this.userId), isNull(workspaceMembers.deletedAt)));
    return result[0]?.count ?? 0;
  };

  listUserWorkspaces = async () => {
    const memberships = await this.db.query.workspaceMembers.findMany({
      where: and(eq(workspaceMembers.userId, this.userId), isNull(workspaceMembers.deletedAt)),
    });

    if (memberships.length === 0) return [];

    const workspaceIds = memberships.map((m) => m.workspaceId);

    const results = await this.db.query.workspaces.findMany({
      orderBy: [desc(workspaces.updatedAt)],
      where: (ws, { inArray }) => inArray(ws.id, workspaceIds),
    });

    return results.map((ws) => ({
      ...ws,
      role: memberships.find((m) => m.workspaceId === ws.id)?.role ?? 'viewer',
    }));
  };

  update = async (
    id: string,
    value: Partial<Pick<WorkspaceItem, 'avatar' | 'description' | 'name' | 'slug'>>,
  ) => {
    return this.db
      .update(workspaces)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  };

  updateSettings = async (id: string, settings: Record<string, any>) => {
    return this.db
      .update(workspaces)
      .set({ settings, updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  };

  updateApiKeyMemberCreation = async (
    id: string,
    memberCreation: WorkspaceApiKeyMemberCreation,
  ) => {
    return this.db
      .update(workspaces)
      .set({
        settings: sql`coalesce(${workspaces.settings}, '{}'::jsonb) || jsonb_build_object(
          'apiKey',
          coalesce(${workspaces.settings}->'apiKey', '{}'::jsonb) || jsonb_build_object('memberCreation', ${memberCreation}::text)
        )`,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, id));
  };

  /**
   * Transfer the unique Owner role and Stripe binding to an existing Admin.
   * The previous Owner becomes Admin in the same transaction, keeping
   * `primaryOwnerId`, the compatibility membership role, and RBAC in sync.
   */
  transferPrimaryOwnership = async (id: string, newPrimaryOwnerUserId: string) => {
    if (newPrimaryOwnerUserId === this.userId)
      throw new Error('New owner must be a different user');

    return this.db.transaction(async (tx) => {
      const current = await tx.query.workspaces.findFirst({
        where: eq(workspaces.id, id),
      });

      if (!current) throw new Error('Workspace not found');
      if (current.primaryOwnerId !== this.userId)
        throw new Error('Only the workspace owner can transfer ownership');

      const targetMembership = await tx.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, newPrimaryOwnerUserId),
          isNull(workspaceMembers.deletedAt),
        ),
      });
      if (!targetMembership)
        throw new Error('Target user must already be a member of the workspace');
      // A legacy non-primary `owner` label counts as Admin everywhere else
      // (see getActiveMembershipRole) — accept it here too so unconverged
      // co-owner workspaces can still transfer ownership.
      if (targetMembership.role !== 'admin' && targetMembership.role !== 'owner')
        throw new Error('Target user must already be an admin');

      // Compare-and-swap on the still-current owner: two concurrent transfers
      // both read the same primaryOwnerId above, but only the first one can
      // match this predicate — the loser aborts before touching any role row.
      // (The DB-level unique active-owner index ships separately.)
      const swapped = await tx
        .update(workspaces)
        .set({ primaryOwnerId: newPrimaryOwnerUserId, updatedAt: new Date() })
        .where(and(eq(workspaces.id, id), eq(workspaces.primaryOwnerId, this.userId)))
        .returning({ id: workspaces.id });
      if (swapped.length === 0) throw new Error('Only the workspace owner can transfer ownership');

      await tx
        .update(workspaceMembers)
        .set({ role: 'admin' })
        .where(and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, this.userId)));
      await tx
        .update(workspaceMembers)
        .set({ role: 'owner' })
        .where(
          and(
            eq(workspaceMembers.workspaceId, id),
            eq(workspaceMembers.userId, newPrimaryOwnerUserId),
          ),
        );

      return {
        newPrimaryOwnerUserId,
        previousPrimaryOwnerUserId: this.userId,
        workspaceId: id,
      };
    });
  };

  /**
   * Downgrade the workspace to Free: clear the grace-period marker so the
   * workspace is no longer in the cancel-grace window. Members are preserved
   * — Free supports multiple members, and the billing-inactive lockout (see
   * `assertSubscriptionActive`) gives view-only access until the owner
   * renews. Workspace-scoped resources (agents/sessions/etc.) stay attached.
   */
  downgradeToFree = async (id: string) => {
    return this.db.transaction(async (tx) => {
      const current = await tx.query.workspaces.findFirst({
        where: eq(workspaces.id, id),
      });

      if (!current) throw new Error('Workspace not found');
      if (current.primaryOwnerId !== this.userId)
        throw new Error('Only the workspace owner can downgrade this workspace');

      const currentSettings = (current.settings as Record<string, any> | null) ?? {};
      const { gracePeriodUntil: _drop, ...restSettings } = currentSettings;

      const [updated] = await tx
        .update(workspaces)
        .set({
          settings: restSettings,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, id))
        .returning();

      return { workspace: updated };
    });
  };

  setGracePeriod = async (id: string, gracePeriodUntil: number | null) => {
    const current = await this.db.query.workspaces.findFirst({
      columns: { settings: true },
      where: eq(workspaces.id, id),
    });
    if (!current) throw new Error('Workspace not found');

    const prev = (current.settings as Record<string, any> | null) ?? {};
    const next =
      gracePeriodUntil === null
        ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== 'gracePeriodUntil'))
        : { ...prev, gracePeriodUntil };

    await this.db
      .update(workspaces)
      .set({ settings: next, updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  };
}
