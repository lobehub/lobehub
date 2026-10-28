import { z } from 'zod';

import type { PublicChatGroup } from '../helpers/public-fields';
import type { IPaginationQuery } from './common.type';
import { PaginationQuerySchema } from './common.type';

// The supervisor is the group's own synthetic agent, created with the group;
// an existing agent can never be promoted into that role.
export const CHAT_GROUP_MEMBER_ROLES = ['participant', 'assistant'] as const;

export const ChatGroupListQuerySchema = PaginationQuerySchema.pick({
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
