import { AgentModel } from '@/database/models/agent';
import { SessionGroupModel } from '@/database/models/sessionGroup';
import type { SessionGroupItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { homeRouter } from '@/server/routers/lambda/home';
import { sessionGroupRouter } from '@/server/routers/lambda/sessionGroup';

import { BaseService } from '../common/base.service';
import type { PaginationRequest } from '../helpers/pagination';
import { resolvePagination } from '../helpers/pagination';
import { rethrowCallerError } from '../helpers/trpc-caller';
import type { DeletedResource } from '../types/common.type';
import type {
  CreateSessionGroupRequest,
  MoveAgentsToSessionGroupRequest,
  PublicSessionGroup,
  ReorderSessionGroupsRequest,
  UpdateSessionGroupRequest,
} from '../types/session-group.type';

const toIso = (value: Date | string) => new Date(value).toISOString();

const projectPublicSessionGroup = (group: SessionGroupItem): PublicSessionGroup => ({
  createdAt: toIso(group.createdAt),
  id: group.id,
  name: group.name,
  sort: group.sort ?? null,
  updatedAt: toIso(group.updatedAt),
  visibility: (group.visibility as 'private' | 'public' | null) ?? 'public',
});

/**
 * Session groups (sidebar folders) over REST.
 *
 * Writes go through the `sessionGroup` tRPC procedures and filing agents
 * through `home.updateAgentSessionGroupId` (server-side callers), so REST keeps
 * their rules: rename/reorder never re-scopes a folder, publishing is one-way
 * and refuses a folder that still holds private items, and an agent only moves
 * into a folder of its own visibility bucket. Folders and agents are resolved
 * with the caller's scope (personal = own rows, workspace = rows visible in
 * `X-Workspace-Id`) first, so anything outside it reads as 404.
 */
export class SessionGroupRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };
  private readonly model: SessionGroupModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
    this.model = new SessionGroupModel(db, this.userId, workspaceId);
  }

  private get groups() {
    return sessionGroupRouter.createCaller(this.ctx);
  }

  private get home() {
    return homeRouter.createCaller(this.ctx);
  }

  private fail(operation: string) {
    return (error: unknown): never =>
      rethrowCallerError(error, (cause) => this.handleServiceError(cause, operation));
  }

  private async findOrThrow(id: string) {
    const group = await this.model.findById(id);
    if (!group) throw this.createNotFoundError('Session group not found');
    return group;
  }

  async listGroups(
    request: PaginationRequest,
  ): Promise<{ items: PublicSessionGroup[]; total: number }> {
    const all = (await this.groups
      .getSessionGroup()
      .catch(this.fail('list session groups'))) as unknown as SessionGroupItem[];
    const { limit, offset } = resolvePagination(request);
    return {
      items: all.slice(offset, offset + limit).map(projectPublicSessionGroup),
      total: all.length,
    };
  }

  async getGroup(id: string): Promise<PublicSessionGroup> {
    return projectPublicSessionGroup(await this.findOrThrow(id));
  }

  async createGroup(request: CreateSessionGroupRequest): Promise<PublicSessionGroup> {
    const id = await this.groups
      .createSessionGroup(request)
      .catch(this.fail('create session group'));
    if (!id) throw this.createBusinessError('Session group was not created');
    return this.getGroup(id);
  }

  async updateGroup(id: string, request: UpdateSessionGroupRequest): Promise<PublicSessionGroup> {
    await this.findOrThrow(id);
    const { visibility, ...value } = request;

    // Publish first: it is the step that can be refused (the folder still holds
    // private items), and doing it before the rename keeps a refused request
    // from leaving a half-applied change behind.
    if (visibility === 'public') {
      await this.groups
        .publishSessionGroupToWorkspace({ id })
        .catch(this.fail('publish session group'));
    }
    if (value.name !== undefined || value.sort !== undefined) {
      await this.groups.updateSessionGroup({ id, value }).catch(this.fail('update session group'));
    }
    return this.getGroup(id);
  }

  async deleteGroup(id: string): Promise<DeletedResource> {
    await this.findOrThrow(id);
    await this.groups.removeSessionGroup({ id }).catch(this.fail('delete session group'));
    return { deleted: true, id };
  }

  async reorderGroups(request: ReorderSessionGroupsRequest): Promise<PublicSessionGroup[]> {
    const ids = request.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw this.createValidationError('Each session group may appear only once');
    }
    const inScope = new Set((await this.model.query()).map((group) => group.id));
    const missing = ids.filter((id) => !inScope.has(id));
    if (missing.length > 0) {
      throw this.createNotFoundError(`Session group not found: ${missing.join(', ')}`);
    }

    await this.groups
      .updateSessionGroupOrder({ sortMap: request.items })
      .catch(this.fail('reorder session groups'));
    const byId = new Map((await this.model.query()).map((group) => [group.id, group]));
    return ids.map((id) => projectPublicSessionGroup(byId.get(id)!));
  }

  async moveAgents(
    request: MoveAgentsToSessionGroupRequest,
  ): Promise<{ agentIds: string[]; sessionGroupId: string | null }> {
    const folder = request.sessionGroupId ? await this.findOrThrow(request.sessionGroupId) : null;

    const agentModel = new AgentModel(this.db, this.userId, this.workspaceId);
    const agentIds = [...new Set(request.agentIds)];
    const visibility = await Promise.all(
      agentIds.map(async (id) =>
        (await agentModel.existsById(id)) ? await agentModel.getAgentVisibility(id) : undefined,
      ),
    );
    const missing = agentIds.filter((_, index) => visibility[index] === undefined);
    if (missing.length > 0)
      throw this.createNotFoundError(`Agent not found: ${missing.join(', ')}`);

    // Check every agent against the folder's visibility bucket before moving
    // any, so a mixed batch is refused whole instead of half-applied (the
    // procedure enforces the same rule one agent at a time).
    if (folder && this.workspaceId) {
      const folderVisibility = folder.visibility ?? 'public';
      const mismatched = agentIds.filter(
        (_, index) => (visibility[index] ?? 'public') !== folderVisibility,
      );
      if (mismatched.length > 0) {
        throw this.createValidationError(
          `Only ${folderVisibility} agents can be moved into a ${folderVisibility} folder: ${mismatched.join(', ')}`,
        );
      }
    }

    for (const agentId of agentIds) {
      await this.home
        .updateAgentSessionGroupId({ agentId, sessionGroupId: request.sessionGroupId })
        .catch(this.fail('move agent to session group'));
    }
    return { agentIds, sessionGroupId: request.sessionGroupId };
  }
}
