import {
  PROJECT_COMPLETION_DECISIONS,
  PROJECT_IDENTIFIER_REGEX,
  PROJECT_STATUSES,
  PROJECT_VISIBILITIES,
} from '@lobechat/types';
import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

/**
 * Projects on the public REST API. Every rule — who may read or change a
 * project, which agents and knowledge bases it may take, the completion
 * review — is the `project` tRPC router's, called server-side; these schemas
 * only describe the transport.
 */

// ==================== Shared ====================

const PROJECT_SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const projectSlug = z
  .string()
  .max(100)
  .regex(PROJECT_SLUG_REGEX, 'Invalid project slug')
  .describe('URL-safe handle, lowercase letters and digits joined by `-` or `_`.');

const projectIdentifier = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(PROJECT_IDENTIFIER_REGEX, 'Invalid project identifier'))
  .describe('Task prefix, 3–6 letters or digits starting with a letter (e.g. `LOBE`).');

export const ProjectStatusSchema = z
  .enum(PROJECT_STATUSES)
  .describe(
    '`backlog` → `active` ⇄ `paused`; `reviewing` while a completion request waits for a human; `completed` once accepted.',
  );

const visibility = z
  .enum(PROJECT_VISIBILITIES)
  .describe('`public` projects are visible to the whole workspace; `private` ones to the creator.');

export const ProjectIdParamSchema = z.object({
  id: z.string().min(1).describe('Project id (`prj_…`), slug or identifier.'),
});

export const ProjectAgentParamSchema = ProjectIdParamSchema.extend({
  agentId: z.string().min(1),
});

export const ProjectKnowledgeBaseParamSchema = ProjectIdParamSchema.extend({
  knowledgeBaseId: z.string().min(1),
});

export const ProjectWorkParamSchema = ProjectIdParamSchema.extend({
  workId: z.string().min(1),
});

// ==================== Responses ====================

export const ProjectSchema = z
  .object({
    archivedAt: dateTimeSchema.nullable(),
    avatar: z.string().nullable(),
    completedAt: dateTimeSchema.nullable(),
    coordinatorAgentId: z
      .string()
      .describe("The project's main agent; LobeAI when the project has none of its own."),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    id: z.string(),
    identifier: z.string().nullable(),
    name: z.string(),
    slug: z.string().nullable(),
    startedAt: dateTimeSchema.nullable(),
    status: ProjectStatusSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().describe('The creator.'),
    visibility,
    workspaceId: z.string().nullable(),
  })
  .meta({ id: 'Project' });

export type ProjectResponse = z.infer<typeof ProjectSchema>;

export const ProjectListResponseSchema = paginatedListSchema(ProjectSchema);

const AgentSummarySchema = z.object({
  avatar: z.string().nullable(),
  backgroundColor: z.string().nullable(),
  description: z.string().nullable(),
  id: z.string(),
  slug: z.string().nullable(),
  title: z.string().nullable(),
});

export const ProjectAgentSchema = z
  .object({
    agent: AgentSummarySchema,
    agentId: z.string(),
    createdAt: dateTimeSchema,
    enabled: z.boolean(),
    responsibility: z.string().nullable(),
    role: z.string().nullable(),
    sortOrder: z.number().int(),
    updatedAt: dateTimeSchema,
  })
  .meta({ id: 'ProjectAgent' });

export type ProjectAgentResponse = z.infer<typeof ProjectAgentSchema>;

/** A binding as a write returns it, without the joined agent. */
export const ProjectAgentBindingSchema = ProjectAgentSchema.omit({ agent: true }).meta({
  id: 'ProjectAgentBinding',
});

export type ProjectAgentBindingResponse = z.infer<typeof ProjectAgentBindingSchema>;

export const ProjectAgentListResponseSchema = z.object({ items: z.array(ProjectAgentSchema) });

const KnowledgeBaseSummarySchema = z.object({
  avatar: z.string().nullable(),
  description: z.string().nullable(),
  id: z.string(),
  name: z.string(),
});

export const ProjectKnowledgeBaseSchema = z
  .object({
    createdAt: dateTimeSchema,
    enabled: z.boolean(),
    knowledgeBase: KnowledgeBaseSummarySchema,
    knowledgeBaseId: z.string(),
    sortOrder: z.number().int(),
    updatedAt: dateTimeSchema,
  })
  .meta({ id: 'ProjectKnowledgeBase' });

export type ProjectKnowledgeBaseResponse = z.infer<typeof ProjectKnowledgeBaseSchema>;

export const ProjectKnowledgeBaseBindingSchema = ProjectKnowledgeBaseSchema.omit({
  knowledgeBase: true,
}).meta({ id: 'ProjectKnowledgeBaseBinding' });

export type ProjectKnowledgeBaseBindingResponse = z.infer<typeof ProjectKnowledgeBaseBindingSchema>;

export const ProjectKnowledgeBaseListResponseSchema = z.object({
  items: z.array(ProjectKnowledgeBaseSchema),
});

const WorkSummarySchema = z.object({
  createdAt: dateTimeSchema,
  description: z.string().nullable(),
  id: z.string(),
  identifier: z.string().nullable(),
  resourceId: z.string().nullable(),
  resourceType: z.string().describe('What the work points at: `document`, `canvas`, `file`, …'),
  status: z.string().nullable(),
  title: z.string().nullable(),
  type: z.string().describe('`document`, `canvas`, `file`, `task`, `external`, …'),
  updatedAt: dateTimeSchema,
  url: z.string().nullable(),
  visibility: z.enum(['private', 'public']),
});

export const ProjectWorkSchema = z
  .object({
    createdAt: dateTimeSchema,
    sortOrder: z.number().int(),
    updatedAt: dateTimeSchema,
    work: WorkSummarySchema,
    workId: z.string(),
  })
  .meta({ id: 'ProjectWork' });

export type ProjectWorkResponse = z.infer<typeof ProjectWorkSchema>;

export const ProjectWorkBindingSchema = ProjectWorkSchema.omit({ work: true }).meta({
  id: 'ProjectWorkBinding',
});

export type ProjectWorkBindingResponse = z.infer<typeof ProjectWorkBindingSchema>;

export const ProjectWorkListResponseSchema = z.object({ items: z.array(ProjectWorkSchema) });

export const ProjectCompletionReviewSchema = z
  .object({
    comment: z.string().nullable(),
    createdAt: dateTimeSchema,
    decision: z.enum(PROJECT_COMPLETION_DECISIONS),
    id: z.string(),
    reviewerUserId: z.string().nullable(),
    round: z.number().int().min(1),
  })
  .meta({ id: 'ProjectCompletionReview' });

export type ProjectCompletionReviewResponse = z.infer<typeof ProjectCompletionReviewSchema>;

export const ProjectCompletionReviewListResponseSchema = z.object({
  items: z.array(ProjectCompletionReviewSchema),
});

// ==================== Requests ====================

const statusList = z
  .union([z.enum(PROJECT_STATUSES), z.array(z.enum(PROJECT_STATUSES))])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export const ProjectListQuerySchema = CursorPaginationQuerySchema.extend({
  status: z
    .preprocess(
      (value) => (typeof value === 'string' && value.includes(',') ? value.split(',') : value),
      statusList,
    )
    .optional()
    .describe('Only projects in these statuses; comma-separated (`active,paused`).'),
});

export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

export const CreateProjectRequestSchema = z.object({
  avatar: z.string().optional(),
  coordinatorAgentId: z
    .string()
    .optional()
    .describe('An existing agent to lead the project. Omit to create a dedicated main agent.'),
  description: z.string().optional(),
  identifier: projectIdentifier.optional(),
  name: z.string().min(1).max(255),
  repository: z
    .object({
      defaultBranch: z.string().max(255).optional(),
      name: z.string().trim().min(1).max(255),
      url: z.string().min(1).max(2048),
    })
    .optional()
    .describe('A code repository the project works in.'),
  slug: projectSlug.optional(),
  visibility: visibility.optional(),
});

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const UpdateProjectRequestSchema = z
  .object({
    avatar: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    name: z.string().min(1).max(255).optional(),
    slug: projectSlug.nullable().optional(),
    visibility: visibility.optional().describe('Only the creator may change it.'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

export const UpdateProjectStatusRequestSchema = z.object({
  status: z
    .enum(PROJECT_STATUSES)
    .exclude(['completed', 'reviewing'])
    .describe(
      '`reviewing` and `completed` are reached through a completion request and its review.',
    ),
});

export type UpdateProjectStatusRequest = z.infer<typeof UpdateProjectStatusRequestSchema>;

const agentBindingFields = {
  enabled: z.boolean().optional(),
  responsibility: z.string().max(1000).nullable().optional(),
  role: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().optional(),
};

export const AddProjectAgentRequestSchema = z.object({
  agentId: z.string().min(1),
  ...agentBindingFields,
});

export type AddProjectAgentRequest = z.infer<typeof AddProjectAgentRequestSchema>;

export const UpdateProjectAgentRequestSchema = z.object(agentBindingFields);

export type UpdateProjectAgentRequest = z.infer<typeof UpdateProjectAgentRequestSchema>;

const knowledgeBaseBindingFields = {
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const AddProjectKnowledgeBaseRequestSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  ...knowledgeBaseBindingFields,
});

export type AddProjectKnowledgeBaseRequest = z.infer<typeof AddProjectKnowledgeBaseRequestSchema>;

export const UpdateProjectKnowledgeBaseRequestSchema = z.object(knowledgeBaseBindingFields);

export type UpdateProjectKnowledgeBaseRequest = z.infer<
  typeof UpdateProjectKnowledgeBaseRequestSchema
>;

export const AddProjectWorkRequestSchema = z.object({
  sortOrder: z.number().int().optional(),
  workId: z.string().min(1).describe('A work (document, canvas, file, …) the caller can see.'),
});

export type AddProjectWorkRequest = z.infer<typeof AddProjectWorkRequestSchema>;

export const ReviewProjectCompletionRequestSchema = z
  .object({
    comment: z.string().optional().describe('Required when rejecting: what is still missing.'),
    decision: z.enum(PROJECT_COMPLETION_DECISIONS),
  })
  .refine((value) => value.decision === 'accepted' || !!value.comment?.trim(), {
    message: 'A rejection needs a comment',
    path: ['comment'],
  });

export type ReviewProjectCompletionRequest = z.infer<typeof ReviewProjectCompletionRequestSchema>;
