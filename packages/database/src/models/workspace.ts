import { WORKSPACE_SYSTEM_ROLES } from '@lobechat/const/rbac';
import { and, count, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { roles, userRoles } from '../schemas/rbac';
import {
  type NewWorkspace,
  type WorkspaceItem,
  workspaceMembers,
  workspaces,
} from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';
import {
  assignWorkspaceRoleToUser,
  revokeWorkspaceRolesForUser,
  seedWorkspaceRoles,
} from '../utils/seedWorkspaceRoles';

const hasWorkspaceOwnerRole = async (
  db: Pick<LobeChatDatabase, 'select'>,
  workspaceId: string,
  userId: string,
): Promise<boolean> => {
  const rows = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.workspaceId, workspaceId),
        eq(roles.name, WORKSPACE_SYSTEM_ROLES.OWNER),
        eq(roles.workspaceId, workspaceId),
        eq(roles.isActive, true),
        sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
      ),
    )
    .limit(1);

  return rows.length > 0;
};

/**
 * Whether `userId` currently holds owner status in `workspaceId` — the RBAC
 * owner role, with a fallback to the membership role for workspaces created
 * before RBAC seeding landed. Used by the workspace-API-key owner gates on
 * both the OpenAPI and lambda TRPC surfaces.
 */
export const hasWorkspaceOwnerAccess = async (
  db: LobeChatDatabase,
  params: { userId: string; workspaceId: string },
): Promise<boolean> => {
  if (await hasWorkspaceOwnerRole(db, params.workspaceId, params.userId)) return true;

  const membership = await db.query.workspaceMembers.findFirst({
    columns: { role: true },
    where: and(
      eq(workspaceMembers.workspaceId, params.workspaceId),
      eq(workspaceMembers.userId, params.userId),
      isNull(workspaceMembers.deletedAt),
    ),
  });

  return membership?.role === 'owner';
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

      await tx.insert(workspaceMembers).values({
        role: 'owner',
        userId: this.userId,
        workspaceId: workspace.id,
      });

      // Seed the built-in RBAC roles and grant the creator `workspace_owner`
      // so role-based checks (e.g. the workspace API key owner gate) see the
      // owner from day one — `workspace_members.role` alone is not enough.
      await seedWorkspaceRoles(tx, workspace.id);
      await assignWorkspaceRoleToUser(tx, {
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId: this.userId,
        workspaceId: workspace.id,
      });

      return workspace;
    });
  };

  delete = async (id: string) => {
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

  /**
   * Transfer the Stripe binding (primary owner) to another existing `owner`
   * member. Both users keep role='owner' afterwards — only the Stripe binding
   * moves. Use `promoteToOwner` first if the target isn't already an owner.
   */
  transferPrimaryOwnership = async (id: string, newPrimaryOwnerUserId: string) => {
    if (newPrimaryOwnerUserId === this.userId)
      throw new Error('New primary owner must be a different user');

    return this.db.transaction(async (tx) => {
      const current = await tx.query.workspaces.findFirst({
        where: eq(workspaces.id, id),
      });

      if (!current) throw new Error('Workspace not found');
      if (current.primaryOwnerId !== this.userId)
        throw new Error('Only the primary owner can transfer primary ownership');

      const targetMembership = await tx.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, newPrimaryOwnerUserId),
          isNull(workspaceMembers.deletedAt),
        ),
      });
      if (!targetMembership)
        throw new Error('Target user must already be a member of the workspace');
      const targetIsOwner = await hasWorkspaceOwnerRole(tx, id, newPrimaryOwnerUserId);
      if (!targetIsOwner)
        throw new Error('Target user must already be an owner — promote them first');

      await tx
        .update(workspaces)
        .set({ primaryOwnerId: newPrimaryOwnerUserId, updatedAt: new Date() })
        .where(eq(workspaces.id, id));

      return {
        newPrimaryOwnerUserId,
        previousPrimaryOwnerUserId: this.userId,
        workspaceId: id,
      };
    });
  };

  promoteToOwner = async (id: string, targetUserId: string) => {
    return this.db.transaction(async (tx) => {
      const actor = await tx.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, this.userId),
          isNull(workspaceMembers.deletedAt),
        ),
      });
      const actorIsOwner = await hasWorkspaceOwnerRole(tx, id, this.userId);
      if (!actor || !actorIsOwner)
        throw new Error('Only an owner can promote other members to owner');

      const target = await tx.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, targetUserId),
          isNull(workspaceMembers.deletedAt),
        ),
      });
      if (!target) throw new Error('Target user is not a member of this workspace');
      const targetIsOwner = await hasWorkspaceOwnerRole(tx, id, targetUserId);
      if (targetIsOwner) return { ...target, role: 'owner' };

      await tx
        .update(workspaceMembers)
        .set({ role: 'owner' })
        .where(
          and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, targetUserId)),
        );
      await revokeWorkspaceRolesForUser(tx, { userId: targetUserId, workspaceId: id });
      await assignWorkspaceRoleToUser(tx, {
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId: targetUserId,
        workspaceId: id,
      });

      return { ...target, role: 'owner' };
    });
  };

  demoteFromOwner = async (id: string, targetUserId: string) => {
    return this.db.transaction(async (tx) => {
      const workspace = await tx.query.workspaces.findFirst({
        where: eq(workspaces.id, id),
      });
      if (!workspace) throw new Error('Workspace not found');
      if (workspace.primaryOwnerId === targetUserId)
        throw new Error(
          'Cannot demote the primary owner — transfer primary ownership to another owner first',
        );

      const actor = await tx.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, this.userId),
          isNull(workspaceMembers.deletedAt),
        ),
      });
      const actorIsOwner = await hasWorkspaceOwnerRole(tx, id, this.userId);
      if (!actor || !actorIsOwner) throw new Error('Only an owner can demote other owners');

      const target = await tx.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, targetUserId),
          isNull(workspaceMembers.deletedAt),
        ),
      });
      if (!target) throw new Error('Target user is not a member of this workspace');
      const targetIsOwner = await hasWorkspaceOwnerRole(tx, id, targetUserId);
      if (!targetIsOwner) return { ...target, role: 'member' };

      await tx
        .update(workspaceMembers)
        .set({ role: 'member' })
        .where(
          and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, targetUserId)),
        );
      await revokeWorkspaceRolesForUser(tx, { userId: targetUserId, workspaceId: id });
      await assignWorkspaceRoleToUser(tx, {
        roleName: WORKSPACE_SYSTEM_ROLES.MEMBER,
        userId: targetUserId,
        workspaceId: id,
      });

      return { ...target, role: 'member' };
    });
  };

  countOtherOwners = async (workspaceId: string, excludeUserId: string): Promise<number> => {
    const result = await this.db
      .select({ count: count() })
      .from(workspaceMembers)
      .innerJoin(
        userRoles,
        and(eq(userRoles.userId, workspaceMembers.userId), eq(userRoles.workspaceId, workspaceId)),
      )
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          ne(workspaceMembers.userId, excludeUserId),
          isNull(workspaceMembers.deletedAt),
          eq(roles.name, WORKSPACE_SYSTEM_ROLES.OWNER),
          eq(roles.workspaceId, workspaceId),
          eq(roles.isActive, true),
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      );
    return result[0]?.count ?? 0;
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
        throw new Error('Only the primary owner can downgrade this workspace');

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
