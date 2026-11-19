import { z } from 'zod';

import { RESOURCE_ACCESS_LEVELS_BY_TYPE } from '@/database/schemas';

import { AgentFileSchema, AgentKnowledgeBaseSchema } from './agent.type';

// ==================== Params ====================

export const AgentSlugParamSchema = z.object({
  slug: z.string().trim().min(1, 'Agent slug cannot be empty'),
});

export const AgentFileParamSchema = z.object({
  fileId: z.string().min(1, 'File ID cannot be empty'),
  id: z.string().min(1, 'Agent ID cannot be empty'),
});

export const AgentKnowledgeBaseParamSchema = z.object({
  id: z.string().min(1, 'Agent ID cannot be empty'),
  knowledgeBaseId: z.string().min(1, 'Knowledge base ID cannot be empty'),
});

export const AgentLabelParamSchema = z.object({
  id: z.string().min(1, 'Agent ID cannot be empty'),
  labelId: z.string().min(1, 'Label ID cannot be empty'),
});

// ==================== Knowledge ====================

export const AttachAgentFilesRequestSchema = z
  .object({
    /** Defaults to `true`: the files are used in retrieval as soon as they are mounted. */
    enabled: z.boolean().optional(),
    fileIds: z
      .array(z.string().min(1, 'File ID cannot be empty'))
      .min(1, 'At least one file ID is required')
      .max(100, 'At most 100 files per request'),
  })
  .strict();

export const AttachAgentKnowledgeBaseRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    knowledgeBaseId: z.string().min(1, 'Knowledge base ID cannot be empty'),
  })
  .strict();

export const ToggleAgentKnowledgeRequestSchema = z.object({ enabled: z.boolean() }).strict();

export type AttachAgentFilesRequest = z.infer<typeof AttachAgentFilesRequestSchema>;
export type AttachAgentKnowledgeBaseRequest = z.infer<typeof AttachAgentKnowledgeBaseRequestSchema>;

/** The files and knowledge bases mounted on an agent. */
export const AgentKnowledgeSchema = z
  .object({
    files: z.array(AgentFileSchema),
    knowledgeBases: z.array(AgentKnowledgeBaseSchema),
  })
  .strict()
  .meta({ id: 'AgentKnowledge' });

export type AgentKnowledge = z.infer<typeof AgentKnowledgeSchema>;

// ==================== Pin ====================

export const PinAgentRequestSchema = z
  .object({
    /** `false` unpins. Defaults to `true`. */
    pinned: z.boolean().optional(),
  })
  .strict();

export const AgentPinStateSchema = z
  .object({ id: z.string(), pinned: z.boolean() })
  .strict()
  .meta({ id: 'AgentPinState' });

export type AgentPinState = z.infer<typeof AgentPinStateSchema>;

// ==================== Visibility ====================

const agentAccessLevel = z
  .enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agent)
  .describe('What workspace members may do with a public agent: `view`, `use` or `edit`.');

export const UpdateAgentVisibilityRequestSchema = z
  .object({
    accessLevel: agentAccessLevel.optional(),
    visibility: z.enum(['private', 'public']),
  })
  .strict();

export type UpdateAgentVisibilityRequest = z.infer<typeof UpdateAgentVisibilityRequestSchema>;

export const AgentVisibilityStateSchema = z
  .object({
    accessLevel: agentAccessLevel,
    canManage: z.boolean(),
    creatorId: z.string(),
    /** Two-valued summary of `accessLevel` kept for older clients. */
    generalAccess: z.enum(['editor', 'viewer']),
    visibility: z.enum(['private', 'public']),
  })
  .strict()
  .meta({ id: 'AgentVisibilityState' });

export type AgentVisibilityState = z.infer<typeof AgentVisibilityStateSchema>;

// ==================== Transfer ====================

export const TransferAgentRequestSchema = z
  .object({
    /** Cross-workspace move only: the access level the agent gets in the target workspace. */
    targetAccessLevel: agentAccessLevel.optional(),
    /**
     * Hand ownership to another member of the current workspace. Creates a
     * pending request the recipient accepts in the product; nothing moves until
     * then. Mutually exclusive with `targetWorkspaceId`.
     */
    targetMemberId: z.string().min(1).optional(),
    targetVisibility: z.enum(['private', 'public']).optional(),
    /** Destination workspace; `null` moves the agent to the caller's personal space. */
    targetWorkspaceId: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((value) => value.targetMemberId !== undefined || value.targetWorkspaceId !== undefined, {
    message: 'Provide targetWorkspaceId (null for personal space) or targetMemberId',
    path: ['targetWorkspaceId'],
  })
  .refine((value) => !(value.targetMemberId && value.targetWorkspaceId), {
    message: 'targetMemberId and targetWorkspaceId are mutually exclusive',
    path: ['targetMemberId'],
  });

export type TransferAgentRequest = z.infer<typeof TransferAgentRequestSchema>;

export const ResourceTransferResultSchema = z
  .object({
    /** The agent id after the move (unchanged for a member handover). */
    id: z.string(),
    /** Member handover only: the pending request the recipient must accept. */
    requestId: z.string().nullable(),
    /** Its slug in the destination scope (it can change to stay unique there). */
    slug: z.string().nullable(),
    /** `pending` when a member handover awaits acceptance; `transferred` when the move is done. */
    status: z.enum(['pending', 'transferred']),
    /** Set when heavy history is still being migrated in the background. */
    transferJobId: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'ResourceTransferResult' });

export type ResourceTransferResult = z.infer<typeof ResourceTransferResultSchema>;

// ==================== Labels on an agent ====================

export const SetAgentLabelsRequestSchema = z
  .object({
    /** The complete label set; labels not listed are removed. */
    labelIds: z.array(z.string().min(1)).max(100, 'At most 100 labels per agent'),
  })
  .strict();

export type SetAgentLabelsRequest = z.infer<typeof SetAgentLabelsRequestSchema>;
