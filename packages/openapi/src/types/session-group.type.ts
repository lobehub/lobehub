import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

// A session group is a sidebar folder (`session_groups` row) that agents and
// chat groups are filed under. `/agent-groups` is the older name for the same
// resource and stays as it is; `/session-groups` adds visibility, ordering and
// filing agents.

export const SessionGroupIdParamSchema = z.object({
  id: z.string().min(1, 'Session group ID cannot be empty'),
});

export const SessionGroupListQuerySchema = CursorPaginationQuerySchema;

export const CreateSessionGroupRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'Session group name cannot be empty').max(255),
    sort: z.number().int().optional(),
    /** Workspace only: `private` folders are seen by their creator alone. Defaults to `public`. */
    visibility: z.enum(['private', 'public']).optional(),
  })
  .strict();

/**
 * Rename and reorder only. Publishing a private folder is the separate,
 * one-way `visibility` update; there is no way back to private.
 */
export const UpdateSessionGroupRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'Session group name cannot be empty').max(255).optional(),
    sort: z.number().int().nullable().optional(),
    visibility: z
      .literal('public')
      .optional()
      .describe('Publish a private folder into the workspace. One-way.'),
  })
  .strict();

export const ReorderSessionGroupsRequestSchema = z
  .object({
    items: z
      .array(z.object({ id: z.string().min(1), sort: z.number().int() }).strict())
      .min(1, 'At least one session group is required')
      .max(200, 'At most 200 session groups per request'),
  })
  .strict();

export const MoveAgentsToSessionGroupRequestSchema = z
  .object({
    agentIds: z
      .array(z.string().min(1, 'Agent ID cannot be empty'))
      .min(1, 'At least one agent ID is required')
      .max(50, 'At most 50 agents per request'),
    /** The folder to file the agents under; `null` takes them out of any folder. */
    sessionGroupId: z.string().min(1, 'Session group ID cannot be empty').nullable(),
  })
  .strict();

export type CreateSessionGroupRequest = z.infer<typeof CreateSessionGroupRequestSchema>;
export type UpdateSessionGroupRequest = z.infer<typeof UpdateSessionGroupRequestSchema>;
export type ReorderSessionGroupsRequest = z.infer<typeof ReorderSessionGroupsRequestSchema>;
export type MoveAgentsToSessionGroupRequest = z.infer<typeof MoveAgentsToSessionGroupRequestSchema>;
export type SessionGroupListQuery = z.infer<typeof SessionGroupListQuerySchema>;

export const SessionGroupSchema = z
  .object({
    createdAt: dateTimeSchema,
    id: z.string(),
    name: z.string(),
    sort: z.number().int().nullable(),
    updatedAt: dateTimeSchema,
    visibility: z.enum(['private', 'public']),
  })
  .strict()
  .meta({ id: 'SessionGroup' });

export type PublicSessionGroup = z.infer<typeof SessionGroupSchema>;

export const SessionGroupListSchema = paginatedListSchema(SessionGroupSchema, {
  total: true,
}).meta({ id: 'SessionGroupList' });

export const SessionGroupAgentMoveSchema = z
  .object({
    /** The agents now filed under the target (`null` = ungrouped). */
    agentIds: z.array(z.string()),
    sessionGroupId: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'SessionGroupAgentMove' });

export const ReorderedSessionGroupsSchema = z
  .object({ items: z.array(SessionGroupSchema) })
  .strict()
  .meta({ id: 'ReorderedSessionGroups' });
