import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type {
  PermissionResourceType,
  ResourceAccessLevel,
  ResourcePermissionItem,
} from '../schemas';
import { getDefaultResourceAccessLevel, resourcePermissions } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * Access policy for public resources, scoped to one workspace. The table is
 * polymorphic on the subject: `userId IS NULL` rows carry the workspace-wide
 * level, `userId` rows carry per-member collaborator grants that only ever
 * raise a member above that level. Every workspace-wide read below filters
 * `userId IS NULL` — a grant leaking into the workspace-wide semantics is a
 * permission bug, so no caller may query the table directly for the
 * workspace-wide level.
 */
export class ResourcePermissionModel {
  private db: LobeChatDatabase;
  private workspaceId: string;

  constructor(db: LobeChatDatabase, workspaceId: string) {
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private resourceMatch = (resourceType: PermissionResourceType, resourceId: string) =>
    and(
      eq(resourcePermissions.workspaceId, this.workspaceId),
      eq(resourcePermissions.resourceType, resourceType),
      eq(resourcePermissions.resourceId, resourceId),
    );

  /** The workspace-wide subject: the row every member's baseline comes from. */
  private workspaceWideMatch = (resourceType: PermissionResourceType, resourceId: string) =>
    and(this.resourceMatch(resourceType, resourceId), isNull(resourcePermissions.userId));

  /** The explicitly stored workspace-wide access level, if one exists. */
  getAccessLevel = async (
    resourceType: PermissionResourceType,
    resourceId: string,
  ): Promise<ResourceAccessLevel | null> => {
    const [row] = await this.db
      .select({ accessLevel: resourcePermissions.accessLevel })
      .from(resourcePermissions)
      .where(this.workspaceWideMatch(resourceType, resourceId))
      .limit(1);

    return row?.accessLevel ?? null;
  };

  /** Resolve a missing row through the resource-specific Workspace default. */
  getEffectiveAccessLevel = async (
    resourceType: PermissionResourceType,
    resourceId: string,
  ): Promise<ResourceAccessLevel> => {
    return (
      (await this.getAccessLevel(resourceType, resourceId)) ??
      getDefaultResourceAccessLevel(resourceType)
    );
  };

  /** Explicitly persist the workspace-wide access level for a public resource. */
  setAccessLevel = async (
    resourceType: PermissionResourceType,
    resourceId: string,
    accessLevel: ResourceAccessLevel,
    createdBy: string,
  ) => {
    await this.db
      .insert(resourcePermissions)
      .values({
        accessLevel,
        createdBy,
        resourceId,
        resourceType,
        workspaceId: this.workspaceId,
      })
      // The workspace-wide subject has its own partial unique index, whose
      // predicate must be repeated in `targetWhere` to be inferred.
      .onConflictDoUpdate({
        set: { accessLevel, createdBy, updatedAt: new Date() },
        target: [
          resourcePermissions.workspaceId,
          resourcePermissions.resourceType,
          resourcePermissions.resourceId,
        ],
        targetWhere: isNull(resourcePermissions.userId),
      });
  };

  /**
   * All collaborator grant rows of one resource, oldest grant first. Grants
   * made in one batch share a `created_at` — `now()` is the transaction
   * timestamp — so `userId` breaks the tie and keeps the order stable across
   * reads instead of leaving it to the query plan.
   */
  listCollaborators = async (
    resourceType: PermissionResourceType,
    resourceId: string,
  ): Promise<ResourcePermissionItem[]> => {
    return this.db
      .select()
      .from(resourcePermissions)
      .where(
        and(this.resourceMatch(resourceType, resourceId), isNotNull(resourcePermissions.userId)),
      )
      .orderBy(resourcePermissions.createdAt, resourcePermissions.userId);
  };

  /** The collaborator level granted to one member on one resource, if any. */
  getCollaboratorLevel = async (
    resourceType: PermissionResourceType,
    resourceId: string,
    userId: string,
  ): Promise<ResourceAccessLevel | null> => {
    const [row] = await this.db
      .select({ accessLevel: resourcePermissions.accessLevel })
      .from(resourcePermissions)
      .where(
        and(this.resourceMatch(resourceType, resourceId), eq(resourcePermissions.userId, userId)),
      )
      .limit(1);

    return row?.accessLevel ?? null;
  };

  /**
   * Resource ids of one type on which the member holds a grant at exactly the
   * given level. Callers subtract these from restriction sets, so the level
   * is matched exactly — today's grants are single-level per type anyway.
   */
  getCollaboratorResourceIds = async (
    resourceType: PermissionResourceType,
    userId: string,
    accessLevel: ResourceAccessLevel,
  ): Promise<string[]> => {
    const rows = await this.db
      .select({ resourceId: resourcePermissions.resourceId })
      .from(resourcePermissions)
      .where(
        and(
          eq(resourcePermissions.workspaceId, this.workspaceId),
          eq(resourcePermissions.resourceType, resourceType),
          eq(resourcePermissions.userId, userId),
          eq(resourcePermissions.accessLevel, accessLevel),
        ),
      );

    return rows.map((row) => row.resourceId);
  };

  /** Grant (or re-grade) the collaborator level for a batch of members. */
  upsertCollaborators = async (params: {
    accessLevel: ResourceAccessLevel;
    createdBy: string;
    resourceId: string;
    resourceType: PermissionResourceType;
    userIds: string[];
  }) => {
    const { accessLevel, createdBy, resourceId, resourceType, userIds } = params;
    if (userIds.length === 0) return;

    await this.db
      .insert(resourcePermissions)
      .values(
        userIds.map((userId) => ({
          accessLevel,
          createdBy,
          resourceId,
          resourceType,
          userId,
          workspaceId: this.workspaceId,
        })),
      )
      // Mirror of `setAccessLevel`, against the per-member partial index.
      .onConflictDoUpdate({
        set: { accessLevel, createdBy, updatedAt: new Date() },
        target: [
          resourcePermissions.workspaceId,
          resourcePermissions.resourceType,
          resourcePermissions.resourceId,
          resourcePermissions.userId,
        ],
        targetWhere: isNotNull(resourcePermissions.userId),
      });
  };

  /** Revoke the collaborator grants of the given members on one resource. */
  removeCollaborators = async (
    resourceType: PermissionResourceType,
    resourceId: string,
    userIds: string[],
  ) => {
    if (userIds.length === 0) return;

    await this.db
      .delete(resourcePermissions)
      .where(
        and(
          this.resourceMatch(resourceType, resourceId),
          inArray(resourcePermissions.userId, userIds),
        ),
      );
  };

  /**
   * Revoke every grant the member holds across this workspace, e.g. when they
   * leave it. Membership removal is a soft delete that re-inviting reactivates,
   * so grants left behind would silently come back with the member. The
   * workspace-wide rows carry no subject and are untouched.
   */
  removeMemberGrants = async (userId: string) => {
    await this.db
      .delete(resourcePermissions)
      .where(
        and(
          eq(resourcePermissions.workspaceId, this.workspaceId),
          eq(resourcePermissions.userId, userId),
        ),
      );
  };

  /**
   * Remove every permission row of a resource — the workspace-wide level and
   * its collaborator grants — e.g. when the resource is deleted or
   * transferred out of the workspace.
   */
  removeAll = async (resourceType: PermissionResourceType, resourceId: string) => {
    await this.db.delete(resourcePermissions).where(this.resourceMatch(resourceType, resourceId));
  };
}
