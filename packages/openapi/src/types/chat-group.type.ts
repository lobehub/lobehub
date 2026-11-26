import { z } from 'zod';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import type { PublicChatGroup, PublicChatGroupMember } from '../helpers/public-fields';
import type { IPaginationQuery } from './common.type';
import { dateTimeSchema, PaginationQuerySchema } from './common.type';

// The supervisor is the group's own synthetic agent, created with the group;
// an existing agent can never be promoted into that role.
export const CHAT_GROUP_MEMBER_ROLES = ['participant', 'assistant'] as const;

export const ChatGroupListQuerySchema = PaginationQuerySchema.pick({
  cursor: true,
  limit: true,
  page: true,
  pageSize: true,
}).extend({
  personal: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const ChatGroupIdParamSchema = z.object({
  id: z.string().min(1, 'Chat group ID cannot be empty'),
});

const AgentIdsSchema = z
  .array(z.string().min(1, 'Agent ID cannot be empty'))
  .min(1, 'At least one agent ID is required')
  .max(50, 'At most 50 agents per request');

export const CreateChatGroupRequestSchema = z.object({
  avatar: z.string().nullish(),
  backgroundColor: z.string().nullish(),
  clientId: z.string().nullish(),
  members: z
    .array(
      z.object({
        agentId: z.string().min(1, 'Agent ID cannot be empty'),
        role: z.enum(CHAT_GROUP_MEMBER_ROLES).optional(),
      }),
    )
    .max(50, 'At most 50 members per group'),
  personal: z.boolean().optional(),
  title: z.string().min(1, 'Title cannot be empty'),
});

export const UpdateChatGroupRequestSchema = z.object({
  avatar: z.string().nullish(),
  backgroundColor: z.string().nullish(),
  description: z.string().nullish(),
  personal: z.boolean().optional(),
  pinned: z.boolean().optional(),
  title: z.string().min(1, 'Title cannot be empty').optional(),
});

export const ChatGroupMembersRequestSchema = z.object({
  agentIds: AgentIdsSchema,
});

export type CreateChatGroupRequest = z.infer<typeof CreateChatGroupRequestSchema>;
export type UpdateChatGroupRequest = z.infer<typeof UpdateChatGroupRequestSchema>;
export type ChatGroupMembersRequest = z.infer<typeof ChatGroupMembersRequestSchema>;
export type GetChatGroupsRequest = Pick<IPaginationQuery, 'page' | 'pageSize'> & {
  personal?: boolean;
};

export interface ChatGroupListResponse {
  chatGroups: PublicChatGroup[];
  total: number;
}

// ==================== Response Schemas ====================

/** One `chat_groups_agents` row as `projectPublicChatGroup` exposes it. */
export const ChatGroupMemberSchema = z
  .object({
    agentId: z.string(),
    enabled: z.boolean().nullable(),
    order: z.number().int().nullable(),
    // `supervisor` is the group's own synthetic agent; callers can only assign the other two.
    role: z.enum(['supervisor', ...CHAT_GROUP_MEMBER_ROLES]).nullable(),
  } satisfies Record<keyof PublicChatGroupMember, z.ZodType>)
  .strict()
  .meta({ id: 'ChatGroupMember' });

export const ChatGroupSchema = z
  .object({
    avatar: z.string().nullable(),
    backgroundColor: z.string().nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    id: z.string(),
    /** The supervisor first, then members by `order`. */
    members: z.array(ChatGroupMemberSchema),
    personal: z.boolean(),
    pinned: z.boolean().nullable(),
    title: z.string().nullable(),
    updatedAt: dateTimeSchema,
  } satisfies Record<keyof PublicChatGroup, z.ZodType>)
  .strict()
  .meta({ id: 'ChatGroup' });

export const ChatGroupListSchema = z
  .object({
    ...pageInfoShape,
    chatGroups: z.array(ChatGroupSchema),
    ...totalShape,
  })
  .strict()
  .meta({ id: 'ChatGroupList' });
