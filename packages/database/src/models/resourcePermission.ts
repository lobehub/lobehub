import { and, eq } from 'drizzle-orm';

import type { PermissionResourceType, ResourceAccessLevel } from '../schemas';
import { getDefaultResourceAccessLevel, resourcePermissions } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * Workspace-wide access policy for public resources. All methods are scoped
 * to one workspace; the table is meaningless in personal mode.
 */
export class ResourcePermissionModel {
  private db: LobeChatDatabase;
  private workspaceId: string;

  constructor(db: LobeChatDatabase, workspaceId: string) {
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private accessMatch = (resourceType: PermissionResourceType, resourceId: string) =>
    and(
      eq(resourcePermissions.workspaceId, this.workspaceId),
      eq(resourcePermissions.resourceType, resourceType),
      eq(resourcePermissions.resourceId, resourceId),
    );

  /** The explicitly stored Workspace access level, if one exists. */
  getAccessLevel = async (
    resourceType: PermissionResourceType,
    resourceId: string,
  ): Promise<ResourceAccessLevel | null> => {
    const [row] = await this.db
      .select({ accessLevel: resourcePermissions.accessLevel })
      .from(resourcePermissions)
      .where(this.accessMatch(resourceType, resourceId))
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

  /** Explicitly persist the Workspace access level for a public resource. */
  setAccessLevel = async (
    resourceType: PermissionResourceType,
    resourceId: string,
    accessLevel: ResourceAccessLevel,
    createdBy: string,
  ) => {
    await this.db
      .insert(resourcePermissions)
      .values({
        createdBy,
        resourceId,
        resourceType,
        accessLevel,
        workspaceId: this.workspaceId,
      })
      .onConflictDoUpdate({
        set: { accessLevel, createdBy, updatedAt: new Date() },
        target: [
          resourcePermissions.workspaceId,
          resourcePermissions.resourceType,
          resourcePermissions.resourceId,
        ],
      });
  };

  /** Remove every permission row of a resource, e.g. when it is deleted. */
  removeAll = async (resourceType: PermissionResourceType, resourceId: string) => {
    await this.db
      .delete(resourcePermissions)
      .where(
        and(
          eq(resourcePermissions.workspaceId, this.workspaceId),
          eq(resourcePermissions.resourceType, resourceType),
          eq(resourcePermissions.resourceId, resourceId),
        ),
      );
  };
}
