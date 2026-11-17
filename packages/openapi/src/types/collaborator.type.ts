import { MAX_RESOURCE_COLLABORATORS_PER_ADD } from '@lobechat/const';
import { z } from 'zod';

import type { PermissionResourceType } from '@/database/schemas';
import { RESOURCE_ACCESS_LEVELS } from '@/database/schemas';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';
import { UserProfileSchema } from './workspace.type';

/**
 * Per-resource collaborators and Workspace General Access.
 *
 * Only resources that carry an ACL inside a team workspace are addressable —
 * the whitelist below maps each URL segment onto its permission resource type.
 */
export const COLLABORATOR_RESOURCES = {
  'agent-groups': 'agentGroup',
  'agents': 'agent',
  'documents': 'document',
  'knowledge-bases': 'knowledgeBase',
} as const satisfies Record<string, PermissionResourceType>;

export type CollaboratorResourceSegment = keyof typeof COLLABORATOR_RESOURCES;

const COLLABORATOR_RESOURCE_SEGMENTS = Object.keys(COLLABORATOR_RESOURCES) as [
  CollaboratorResourceSegment,
  ...CollaboratorResourceSegment[],
];

export const ResourceAccessLevelSchema = z
  .enum(RESOURCE_ACCESS_LEVELS)
  .describe(
    '`view` reads, `use` also runs (agents and groups only), `edit` also changes. Documents and knowledge bases accept `view` and `edit`.',
  );

// ==================== Path / Query Schemas ====================

export const CollaboratorResourceParamSchema = z.object({
  resourceId: z.string().min(1).describe('Id of the resource'),
  resourceType: z
    .enum(COLLABORATOR_RESOURCE_SEGMENTS)
    .describe('Kind of resource; only resources with a workspace ACL are accepted'),
});
export type CollaboratorResourceParam = z.infer<typeof CollaboratorResourceParamSchema>;

export const CollaboratorParamSchema = CollaboratorResourceParamSchema.extend({
  userId: z.string().min(1).describe('User id of the collaborator'),
});
export type CollaboratorParam = z.infer<typeof CollaboratorParamSchema>;

export const CollaboratorListQuerySchema = CursorPaginationQuerySchema;
export type CollaboratorListQuery = z.infer<typeof CollaboratorListQuerySchema>;

// ==================== Request Schemas ====================

export const AddCollaboratorsRequestSchema = z
  .object({
    accessLevel: ResourceAccessLevelSchema,
    userIds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_RESOURCE_COLLABORATORS_PER_ADD)
      .describe('Active members of the workspace; the creator is skipped'),
  })
  .strict();
export type AddCollaboratorsRequest = z.infer<typeof AddCollaboratorsRequestSchema>;

export const SetGeneralAccessRequestSchema = z
  .object({ accessLevel: ResourceAccessLevelSchema })
  .strict();
export type SetGeneralAccessRequest = z.infer<typeof SetGeneralAccessRequestSchema>;

// ==================== Response Schemas ====================

export const CollaboratorSchema = z
  .object({
    accessLevel: ResourceAccessLevelSchema,
    createdAt: dateTimeSchema,
    user: UserProfileSchema.nullable(),
    userId: z.string(),
  })
  .strict()
  .meta({ id: 'Collaborator' });
export type Collaborator = z.infer<typeof CollaboratorSchema>;

export const CollaboratorListResponseSchema = paginatedListSchema(CollaboratorSchema, {
  total: true,
});

export const GeneralAccessSchema = z
  .object({
    accessLevel: ResourceAccessLevelSchema.describe(
      'What every workspace member gets on a public resource',
    ),
    canManage: z.boolean().describe('Whether the caller may change collaborators and access'),
    creatorId: z.string(),
    visibility: z
      .enum(['private', 'public'])
      .describe('`private` resources are creator-only whatever the access level'),
  })
  .strict()
  .meta({ id: 'GeneralAccess' });
export type GeneralAccess = z.infer<typeof GeneralAccessSchema>;

/** What adding collaborators answers with: the grants as they now stand for the requested users. */
export const AddedCollaboratorsSchema = z
  .object({ items: z.array(CollaboratorSchema) })
  .strict()
  .meta({ id: 'AddedCollaborators' });
export type AddedCollaborators = z.infer<typeof AddedCollaboratorsSchema>;
