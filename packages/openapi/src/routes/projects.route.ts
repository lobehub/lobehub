import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ProjectController } from '../controllers/project.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  AddProjectAgentRequestSchema,
  AddProjectKnowledgeBaseRequestSchema,
  AddProjectWorkRequestSchema,
  CreateProjectRequestSchema,
  ProjectAgentBindingSchema,
  ProjectAgentListResponseSchema,
  ProjectAgentParamSchema,
  ProjectCompletionReviewListResponseSchema,
  ProjectIdParamSchema,
  ProjectKnowledgeBaseBindingSchema,
  ProjectKnowledgeBaseListResponseSchema,
  ProjectKnowledgeBaseParamSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectSchema,
  ProjectWorkBindingSchema,
  ProjectWorkListResponseSchema,
  ProjectWorkParamSchema,
  ReviewProjectCompletionRequestSchema,
  UpdateProjectAgentRequestSchema,
  UpdateProjectKnowledgeBaseRequestSchema,
  UpdateProjectRequestSchema,
  UpdateProjectStatusRequestSchema,
} from '../types/project.type';

/**
 * Project routes.
 *
 * A project groups the agents that work on it (led by its main agent), the
 * knowledge bases they draw on, the works they produce, and a human completion
 * review. Issuer RBAC is the agent permission the `project` tRPC router checks;
 * restricted API keys need `project:read` / `project:write`.
 */
const ProjectRoutes = new Hono();

const TAGS = ['projects'];

const projectRead = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_READ'),
  'project:read',
  'You do not have permission to view projects',
);
const projectWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_UPDATE'),
  'project:write',
  'You do not have permission to manage projects',
);

const controller = () => new ProjectController();

// ==================== Projects ====================

ProjectRoutes.get(
  '/',
  routeDoc({
    data: ProjectListResponseSchema,
    description: 'Projects the caller can see, most recently updated first.',
    summary: 'List projects',
    tags: TAGS,
  }),
  requireAuth,
  projectRead,
  zValidator('query', ProjectListQuerySchema),
  async (c) => controller().listProjects(c),
);

ProjectRoutes.post(
  '/',
  routeDoc({
    data: ProjectSchema,
    description:
      'Creates a project with its main agent (a dedicated one unless `coordinatorAgentId` names an agent the caller can use) and its default channel. A taken `slug` or `identifier` answers 409.',
    errors: [400, 404, 409],
    status: 201,
    summary: 'Create a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('json', CreateProjectRequestSchema),
  async (c) => controller().createProject(c),
);

ProjectRoutes.get(
  '/:id',
  routeDoc({
    data: ProjectSchema,
    description: 'Looks a project up by id, slug or identifier.',
    errors: [404],
    summary: 'Get a project',
    tags: TAGS,
  }),
  requireAuth,
  projectRead,
  zValidator('param', ProjectIdParamSchema),
  async (c) => controller().getProject(c),
);

ProjectRoutes.patch(
  '/:id',
  routeDoc({
    data: ProjectSchema,
    description:
      'Updates the name, description, avatar, slug or visibility. Only the creator may change visibility; making a public project private also makes its goals private.',
    errors: [400, 404, 409],
    summary: 'Update a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  zValidator('json', UpdateProjectRequestSchema),
  async (c) => controller().updateProject(c),
);

ProjectRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: 'Deletes the project. Its agents, knowledge bases and works stay.',
    errors: [400, 404],
    summary: 'Delete a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  async (c) => controller().deleteProject(c),
);

ProjectRoutes.put(
  '/:id/status',
  routeDoc({
    data: ProjectSchema,
    description:
      'Moves the project between `backlog`, `active`, `paused`, `canceled` and `archived`. Completing a project goes through a completion request and its review instead.',
    errors: [400, 404],
    summary: 'Set the project status',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  zValidator('json', UpdateProjectStatusRequestSchema),
  async (c) => controller().updateStatus(c),
);

// ==================== Agents ====================

ProjectRoutes.get(
  '/:id/agents',
  routeDoc({
    data: ProjectAgentListResponseSchema,
    description: 'The agents working on the project, the main agent first.',
    errors: [404],
    summary: 'List project agents',
    tags: TAGS,
  }),
  requireAuth,
  projectRead,
  zValidator('param', ProjectIdParamSchema),
  async (c) => controller().listAgents(c),
);

ProjectRoutes.post(
  '/:id/agents',
  routeDoc({
    data: ProjectAgentBindingSchema,
    description:
      'Adds an agent the caller can use to the project, or updates its binding when it is already a member. A public project only takes public agents; the main agent is managed by the project.',
    errors: [400, 404],
    operationId: 'projects.addAgent',
    status: 201,
    summary: 'Add an agent to a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  zValidator('json', AddProjectAgentRequestSchema),
  async (c) => controller().addAgent(c),
);

ProjectRoutes.patch(
  '/:id/agents/:agentId',
  routeDoc({
    data: ProjectAgentBindingSchema,
    description: "Changes a member agent's role, responsibility, order or whether it is enabled.",
    errors: [400, 404],
    operationId: 'projects.updateAgent',
    summary: 'Update a project agent',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectAgentParamSchema),
  zValidator('json', UpdateProjectAgentRequestSchema),
  async (c) => controller().updateAgent(c),
);

ProjectRoutes.delete(
  '/:id/agents/:agentId',
  routeDoc({
    data: DeletedResourceSchema,
    description:
      'Removes an agent from the project and its channels. `id` in the answer is the agent id. The main agent cannot be removed.',
    errors: [400, 404],
    operationId: 'projects.removeAgent',
    summary: 'Remove an agent from a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectAgentParamSchema),
  async (c) => controller().removeAgent(c),
);

// ==================== Knowledge bases ====================

ProjectRoutes.get(
  '/:id/knowledge-bases',
  routeDoc({
    data: ProjectKnowledgeBaseListResponseSchema,
    description: "The knowledge bases linked to the project, in the project's order.",
    errors: [404],
    summary: 'List project knowledge bases',
    tags: TAGS,
  }),
  requireAuth,
  projectRead,
  zValidator('param', ProjectIdParamSchema),
  async (c) => controller().listKnowledgeBases(c),
);

ProjectRoutes.post(
  '/:id/knowledge-bases',
  routeDoc({
    data: ProjectKnowledgeBaseBindingSchema,
    description:
      'Links a knowledge base the caller can use, or updates its link when already linked. A public project only takes public knowledge bases.',
    errors: [400, 404],
    operationId: 'projects.addKnowledgeBase',
    status: 201,
    summary: 'Link a knowledge base to a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  zValidator('json', AddProjectKnowledgeBaseRequestSchema),
  async (c) => controller().addKnowledgeBase(c),
);

ProjectRoutes.patch(
  '/:id/knowledge-bases/:knowledgeBaseId',
  routeDoc({
    data: ProjectKnowledgeBaseBindingSchema,
    description: 'Changes the order of a linked knowledge base or whether it is enabled.',
    errors: [400, 404],
    operationId: 'projects.updateKnowledgeBase',
    summary: 'Update a project knowledge base',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectKnowledgeBaseParamSchema),
  zValidator('json', UpdateProjectKnowledgeBaseRequestSchema),
  async (c) => controller().updateKnowledgeBase(c),
);

ProjectRoutes.delete(
  '/:id/knowledge-bases/:knowledgeBaseId',
  routeDoc({
    data: DeletedResourceSchema,
    description:
      'Unlinks a knowledge base; the knowledge base itself stays. `id` in the answer is the knowledge base id.',
    errors: [400, 404],
    operationId: 'projects.removeKnowledgeBase',
    summary: 'Unlink a knowledge base from a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectKnowledgeBaseParamSchema),
  async (c) => controller().removeKnowledgeBase(c),
);

// ==================== Works ====================

ProjectRoutes.get(
  '/:id/works',
  routeDoc({
    data: ProjectWorkListResponseSchema,
    description:
      'What the project has produced — documents, canvases, files, tasks and external issues or pull requests — in the project order.',
    errors: [404],
    summary: 'List project works',
    tags: TAGS,
  }),
  requireAuth,
  projectRead,
  zValidator('param', ProjectIdParamSchema),
  async (c) => controller().listWorks(c),
);

ProjectRoutes.post(
  '/:id/works',
  routeDoc({
    data: ProjectWorkBindingSchema,
    description: 'Files a work the caller can see under the project.',
    errors: [400, 404],
    operationId: 'projects.addWork',
    status: 201,
    summary: 'Add a work to a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  zValidator('json', AddProjectWorkRequestSchema),
  async (c) => controller().addWork(c),
);

ProjectRoutes.delete(
  '/:id/works/:workId',
  routeDoc({
    data: DeletedResourceSchema,
    description:
      'Takes a work off the project; the work itself stays. `id` in the answer is the work id.',
    errors: [400, 404],
    operationId: 'projects.removeWork',
    summary: 'Remove a work from a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectWorkParamSchema),
  async (c) => controller().removeWork(c),
);

// ==================== Completion review ====================

ProjectRoutes.get(
  '/:id/completion-reviews',
  routeDoc({
    data: ProjectCompletionReviewListResponseSchema,
    description: 'Every completion review of the project, the latest round first.',
    errors: [404],
    summary: 'List completion reviews',
    tags: TAGS,
  }),
  requireAuth,
  projectRead,
  zValidator('param', ProjectIdParamSchema),
  async (c) => controller().listCompletionReviews(c),
);

ProjectRoutes.post(
  '/:id/completion-request',
  routeDoc({
    data: ProjectSchema,
    description:
      'Asks a human to confirm the project is done: an `active` or `paused` project moves to `reviewing` until its review.',
    errors: [400, 404],
    operationId: 'projects.requestCompletion',
    summary: 'Request project completion',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  async (c) => controller().requestCompletion(c),
);

ProjectRoutes.post(
  '/:id/completion-reviews',
  routeDoc({
    data: ProjectSchema,
    description:
      'Settles a pending completion request: `accepted` completes the project, `rejected` (with a comment) sends it back to `active`.',
    errors: [400, 404],
    operationId: 'projects.reviewCompletion',
    summary: 'Review a completion request',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  zValidator('json', ReviewProjectCompletionRequestSchema),
  async (c) => controller().reviewCompletion(c),
);

ProjectRoutes.post(
  '/:id/reopen',
  routeDoc({
    data: ProjectSchema,
    description: 'Reopens a completed or archived project that passed review, back to `active`.',
    errors: [400, 404],
    operationId: 'projects.reopen',
    summary: 'Reopen a project',
    tags: TAGS,
  }),
  requireAuth,
  projectWrite,
  zValidator('param', ProjectIdParamSchema),
  async (c) => controller().reopen(c),
);

export default ProjectRoutes;
