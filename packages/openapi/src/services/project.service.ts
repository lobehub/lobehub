import type { LobeChatDatabase } from '@/database/type';
import { projectRouter } from '@/server/routers/lambda/project';

import { BaseService } from '../common/base.service';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  AddProjectAgentRequest,
  AddProjectKnowledgeBaseRequest,
  AddProjectWorkRequest,
  CreateProjectRequest,
  ProjectAgentBindingResponse,
  ProjectAgentResponse,
  ProjectCompletionReviewResponse,
  ProjectKnowledgeBaseBindingResponse,
  ProjectKnowledgeBaseResponse,
  ProjectListQuery,
  ProjectResponse,
  ProjectWorkBindingResponse,
  ProjectWorkResponse,
  ReviewProjectCompletionRequest,
  UpdateProjectAgentRequest,
  UpdateProjectKnowledgeBaseRequest,
  UpdateProjectRequest,
  UpdateProjectStatusRequest,
} from '../types/project.type';

const toIso = (value: Date | string): string => new Date(value).toISOString();
const toIsoOrNull = (value: Date | string | null | undefined) => (value ? toIso(value) : null);

type ProjectRouterCaller = ReturnType<typeof projectRouter.createCaller>;
type ProjectRow = NonNullable<Awaited<ReturnType<ProjectRouterCaller['find']>>>['data'];
type ProjectDetail = NonNullable<Awaited<ReturnType<ProjectRouterCaller['detail']>>>['data'];

type Timestamps = { createdAt: Date | string; updatedAt: Date | string };

export const toProject = (row: ProjectRow): ProjectResponse => ({
  archivedAt: toIsoOrNull(row.archivedAt),
  avatar: row.avatar ?? null,
  completedAt: toIsoOrNull(row.completedAt),
  coordinatorAgentId: row.coordinatorAgentId,
  createdAt: toIso(row.createdAt),
  description: row.description ?? null,
  id: row.id,
  identifier: row.identifier ?? null,
  name: row.name,
  slug: row.slug ?? null,
  startedAt: toIsoOrNull(row.startedAt),
  status: row.status,
  updatedAt: toIso(row.updatedAt),
  userId: row.userId,
  visibility: row.visibility,
  workspaceId: row.workspaceId ?? null,
});

const toAgentBinding = (
  binding: Timestamps & {
    agentId: string;
    enabled: boolean;
    responsibility: string | null;
    role: string | null;
    sortOrder: number;
  },
): ProjectAgentBindingResponse => ({
  agentId: binding.agentId,
  createdAt: toIso(binding.createdAt),
  enabled: binding.enabled,
  responsibility: binding.responsibility ?? null,
  role: binding.role ?? null,
  sortOrder: binding.sortOrder,
  updatedAt: toIso(binding.updatedAt),
});

const toAgent = ({
  agent,
  binding,
}: NonNullable<ProjectDetail['agents']>[number]): ProjectAgentResponse => ({
  ...toAgentBinding(binding),
  agent: {
    avatar: agent.avatar ?? null,
    backgroundColor: agent.backgroundColor ?? null,
    description: agent.description ?? null,
    id: agent.id,
    slug: agent.slug ?? null,
    title: agent.title ?? null,
  },
});

const toKnowledgeBaseBinding = (
  binding: Timestamps & { enabled: boolean; knowledgeBaseId: string; sortOrder: number },
): ProjectKnowledgeBaseBindingResponse => ({
  createdAt: toIso(binding.createdAt),
  enabled: binding.enabled,
  knowledgeBaseId: binding.knowledgeBaseId,
  sortOrder: binding.sortOrder,
  updatedAt: toIso(binding.updatedAt),
});

const toKnowledgeBase = ({
  binding,
  knowledgeBase,
}: NonNullable<ProjectDetail['knowledgeBases']>[number]): ProjectKnowledgeBaseResponse => ({
  ...toKnowledgeBaseBinding(binding),
  knowledgeBase: {
    avatar: knowledgeBase.avatar ?? null,
    description: knowledgeBase.description ?? null,
    id: knowledgeBase.id,
    name: knowledgeBase.name,
  },
});

const toWorkBinding = (
  binding: Timestamps & { sortOrder: number; workId: string },
): ProjectWorkBindingResponse => ({
  createdAt: toIso(binding.createdAt),
  sortOrder: binding.sortOrder,
  updatedAt: toIso(binding.updatedAt),
  workId: binding.workId,
});

const toWork = ({
  binding,
  work,
}: NonNullable<ProjectDetail['works']>[number]): ProjectWorkResponse => ({
  ...toWorkBinding(binding),
  work: {
    createdAt: toIso(work.createdAt),
    description: work.description ?? null,
    id: work.id,
    identifier: work.identifier ?? null,
    resourceId: work.resourceId ?? null,
    resourceType: work.resourceType,
    status: work.status ?? null,
    title: work.title ?? null,
    type: work.type,
    updatedAt: toIso(work.updatedAt),
    url: work.url ?? null,
    visibility: work.visibility,
  },
});

const toCompletionReview = (
  review: NonNullable<ProjectDetail['completionReviews']>[number],
): ProjectCompletionReviewResponse => ({
  comment: review.comment ?? null,
  createdAt: toIso(review.createdAt),
  decision: review.decision,
  id: review.id,
  reviewerUserId: review.reviewerUserId ?? null,
  round: review.round,
});

/**
 * Projects REST service.
 *
 * Every read and write goes through the `project` tRPC procedures, called
 * server-side, so REST shares their visibility rules (a private project, or one
 * in another account or workspace, reads as missing), the `agent:update` RBAC
 * gate on writes, the `use` access check on bound agents and knowledge bases,
 * and the completion review. Paths accept a project id, slug or identifier;
 * each call resolves it to the id first, so an invisible project is a 404 for
 * every operation alike.
 */
export class ProjectRestService extends BaseService {
  private readonly caller: ProjectRouterCaller;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.caller = projectRouter.createCaller({ userId: this.userId, workspaceId });
  }

  private async requireProject(reference: string): Promise<ProjectRow> {
    const result = await this.caller.find({ id: reference });
    return result!.data;
  }

  private async requireDetail(reference: string): Promise<ProjectDetail> {
    const result = await this.caller.detail({ id: reference });
    return result!.data;
  }

  async listProjects(query: ProjectListQuery) {
    const { limit, offset } = resolvePagination(query);
    const result = await this.caller.list({ limit, offset, statuses: query.status });
    return { items: result!.data.map(toProject) };
  }

  async createProject(input: CreateProjectRequest): Promise<ProjectResponse> {
    const result = await this.caller.create(input);
    return toProject(result!.data);
  }

  async getProject(reference: string): Promise<ProjectResponse> {
    return toProject(await this.requireProject(reference));
  }

  async updateProject(reference: string, input: UpdateProjectRequest): Promise<ProjectResponse> {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.update({ id, ...input });
    return toProject(result!.data);
  }

  async deleteProject(reference: string): Promise<DeletedResource> {
    const { id } = await this.requireProject(reference);
    await this.caller.delete({ id });
    return { deleted: true, id };
  }

  async updateStatus(
    reference: string,
    input: UpdateProjectStatusRequest,
  ): Promise<ProjectResponse> {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.updateStatus({ id, status: input.status });
    return toProject(await this.withMainAgent(result!.data));
  }

  // ==================== Agents ====================

  async listAgents(reference: string) {
    return { items: ((await this.requireDetail(reference)).agents ?? []).map(toAgent) };
  }

  async addAgent(reference: string, input: AddProjectAgentRequest) {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.addAgent({ id, ...input });
    return toAgentBinding(result!.data!);
  }

  async updateAgent(reference: string, agentId: string, input: UpdateProjectAgentRequest) {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.updateAgent({ agentId, id, ...input });
    return toAgentBinding(result!.data);
  }

  async removeAgent(reference: string, agentId: string): Promise<DeletedResource> {
    const { id } = await this.requireProject(reference);
    await this.caller.removeAgent({ agentId, id });
    return { deleted: true, id: agentId };
  }

  // ==================== Knowledge bases ====================

  async listKnowledgeBases(reference: string) {
    const detail = await this.requireDetail(reference);
    return { items: (detail.knowledgeBases ?? []).map(toKnowledgeBase) };
  }

  async addKnowledgeBase(reference: string, input: AddProjectKnowledgeBaseRequest) {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.addKnowledgeBase({ id, ...input });
    return toKnowledgeBaseBinding(result!.data!);
  }

  async updateKnowledgeBase(
    reference: string,
    knowledgeBaseId: string,
    input: UpdateProjectKnowledgeBaseRequest,
  ) {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.updateKnowledgeBase({ id, knowledgeBaseId, ...input });
    return toKnowledgeBaseBinding(result!.data);
  }

  async removeKnowledgeBase(reference: string, knowledgeBaseId: string): Promise<DeletedResource> {
    const { id } = await this.requireProject(reference);
    await this.caller.removeKnowledgeBase({ id, knowledgeBaseId });
    return { deleted: true, id: knowledgeBaseId };
  }

  // ==================== Works ====================

  async listWorks(reference: string) {
    const detail = await this.requireDetail(reference);
    return { items: (detail.works ?? []).map(toWork) };
  }

  async addWork(reference: string, input: AddProjectWorkRequest) {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.addWork({ id, ...input });
    return toWorkBinding(result!.data);
  }

  async removeWork(reference: string, workId: string): Promise<DeletedResource> {
    const { id } = await this.requireProject(reference);
    await this.caller.removeWork({ id, workId });
    return { deleted: true, id: workId };
  }

  // ==================== Completion review ====================

  async listCompletionReviews(reference: string) {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.listCompletionReviews({ id });
    return { items: result!.data.map(toCompletionReview) };
  }

  async requestCompletion(reference: string): Promise<ProjectResponse> {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.requestCompletion({ id });
    return toProject(await this.withMainAgent(result!.data));
  }

  async reviewCompletion(
    reference: string,
    input: ReviewProjectCompletionRequest,
  ): Promise<ProjectResponse> {
    const { id } = await this.requireProject(reference);
    if (input.decision === 'accepted')
      await this.caller.acceptCompletion({ comment: input.comment, id });
    else await this.caller.rejectCompletion({ comment: input.comment!, id });
    return toProject(await this.requireProject(id));
  }

  async reopen(reference: string): Promise<ProjectResponse> {
    const { id } = await this.requireProject(reference);
    const result = await this.caller.reopen({ id });
    return toProject(await this.withMainAgent(result!.data));
  }

  /** Writes that return the bare row leave the main agent unresolved; read it back. */
  private async withMainAgent(row: { coordinatorAgentId: string | null; id: string }) {
    return row.coordinatorAgentId ? (row as ProjectRow) : this.requireProject(row.id);
  }
}
