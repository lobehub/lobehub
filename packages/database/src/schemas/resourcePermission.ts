import { isNotNull, isNull } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Entity kinds that support per-resource permission grants. The table is
 * polymorphic on purpose: adding permission support to a new entity only
 * requires a new literal here, not a new table.
 */
export const PERMISSION_RESOURCE_TYPES = [
  'agent',
  'agentGroup',
  'document',
  'knowledgeBase',
] as const;
export type PermissionResourceType = (typeof PERMISSION_RESOURCE_TYPES)[number];

/**
 * Workspace-wide access levels for a public resource:
 * - Agent / Agent Group: `view`, `use`, or `edit`
 * - Document: `view` or `edit`
 * - Knowledge Base: `use` or `edit`
 *
 * `use` grants chat execution without configuration access. `view` is the
 * read-only state. `edit` grants collaborative content/configuration editing
 * but never resource ownership or permission management.
 *
 * Knowledge bases invert the usual view/use ordering: `use` means "mountable
 * on agents for retrieval" while browsing the internal file list is the
 * privileged act, so browsing requires `edit` and there is no `view` level.
 * Permission management is deliberately not an access level: it is derived
 * from creator ownership or a workspace-scoped `:all` RBAC capability.
 */
export const RESOURCE_ACCESS_LEVELS = ['view', 'use', 'edit'] as const;
export type ResourceAccessLevel = (typeof RESOURCE_ACCESS_LEVELS)[number];

export const RESOURCE_ACCESS_LEVELS_BY_TYPE = {
  agent: ['view', 'use', 'edit'],
  agentGroup: ['view', 'use', 'edit'],
  document: ['view', 'edit'],
  knowledgeBase: ['use', 'edit'],
} as const satisfies Record<PermissionResourceType, readonly ResourceAccessLevel[]>;

/**
 * What a public resource grants the workspace when nobody has said otherwise.
 *
 * Agents and Agent Groups default to `edit`: a workspace is a collaborative
 * space, and the same default has to hold for both — a group whose members
 * could only *use* it while the agents inside it were editable (or vice versa)
 * reads as a bug, not as a policy. Documents stay `view`, which is the Notion-
 * style expectation for a written page.
 *
 * Lowering a resource is one control away (the Permission page), and the
 * creator / workspace owners are unaffected either way.
 */
export const DEFAULT_RESOURCE_ACCESS_LEVELS = {
  agent: 'edit',
  agentGroup: 'edit',
  document: 'view',
  // `edit` keeps the pre-feature behavior: every member may browse the file
  // list until an admin/creator explicitly restricts the knowledge base.
  knowledgeBase: 'edit',
} as const satisfies Record<PermissionResourceType, ResourceAccessLevel>;

export const getDefaultResourceAccessLevel = (
  resourceType: PermissionResourceType,
): ResourceAccessLevel => DEFAULT_RESOURCE_ACCESS_LEVELS[resourceType];

/**
 * What the released clients' two-valued `viewer` / `editor` role maps onto.
 *
 * Deliberately not `DEFAULT_RESOURCE_ACCESS_LEVELS`: those two happened to be
 * the same value once, but they answer different questions — "nobody chose"
 * versus "the caller chose the non-editor option". Now that the Agent / Group
 * default is `edit`, resolving `viewer` through the default would hand edit
 * access to a client that explicitly asked for less.
 */
export const LEGACY_VIEWER_ACCESS_LEVELS = {
  agent: 'use',
  agentGroup: 'use',
  document: 'view',
  knowledgeBase: 'use',
} as const satisfies Record<PermissionResourceType, ResourceAccessLevel>;

export const getLegacyViewerAccessLevel = (
  resourceType: PermissionResourceType,
): ResourceAccessLevel => LEGACY_VIEWER_ACCESS_LEVELS[resourceType];

export const isResourceAccessLevelAllowed = (
  resourceType: PermissionResourceType,
  accessLevel: ResourceAccessLevel,
): boolean =>
  (RESOURCE_ACCESS_LEVELS_BY_TYPE[resourceType] as readonly ResourceAccessLevel[]).includes(
    accessLevel,
  );

/**
 * Access policy for public workspace resources, polymorphic on the subject:
 *
 * - `userId IS NULL` — the workspace-wide row: what *every* member may do.
 *   At most one per resource. Public resources without one resolve to the
 *   resource-specific default (`edit` for Agent/Group, `view` for Document),
 *   so no production backfill is needed to keep legacy rows consistent with
 *   newly created ones.
 * - `userId` set — a per-member collaborator grant that lifts that member
 *   above the workspace-wide level. Grants only ever raise: evaluation
 *   resolves `max(workspace level, grant)`, so a grant at or below the
 *   workspace level is inert, never a demotion. Grants never pierce private
 *   resources or the RBAC capability ceiling, and are revoked when the member
 *   leaves the workspace — membership removal is a soft delete that
 *   re-inviting reactivates, so a surviving grant would silently come back
 *   with them.
 *
 * Every read of the workspace-wide policy MUST filter `userId IS NULL`
 * (`ResourcePermissionModel` centralizes this): a per-member grant leaking
 * into a workspace-wide read is a permission bug. Each subject gets its own
 * partial unique index so the workspace-wide row stays unique alongside the
 * per-member rows; upserts repeat the matching predicate in `targetWhere`.
 *
 * Visibility itself stays on the resources' own `visibility` column; this
 * table only grades what visible workspace members may do. Rows staged on a
 * still-private resource are inert until it is published, and are removed
 * together (`removeAll`) when the resource is deleted or transferred.
 */
export const resourcePermissions = pgTable(
  'resource_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    resourceType: text('resource_type', { enum: PERMISSION_RESOURCE_TYPES }).notNull(),
    resourceId: text('resource_id').notNull(),

    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),

    /** Grant subject: `NULL` = the whole workspace, set = one member. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),

    accessLevel: text('access_level', { enum: RESOURCE_ACCESS_LEVELS }).notNull(),

    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('resource_permissions_workspace_resource_unique')
      .on(t.workspaceId, t.resourceType, t.resourceId)
      .where(isNull(t.userId)),
    uniqueIndex('resource_permissions_workspace_resource_user_id_unique')
      .on(t.workspaceId, t.resourceType, t.resourceId, t.userId)
      .where(isNotNull(t.userId)),
    index('resource_permissions_resource_idx').on(t.resourceType, t.resourceId),
    index('resource_permissions_workspace_idx').on(t.workspaceId),
    index('resource_permissions_workspace_user_idx').on(t.workspaceId, t.userId),
  ],
);

export type NewResourcePermission = typeof resourcePermissions.$inferInsert;
export type ResourcePermissionItem = typeof resourcePermissions.$inferSelect;
