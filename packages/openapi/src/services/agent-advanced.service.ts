import { AgentModel } from '@/database/models/agent';
import { AgentLabelModel } from '@/database/models/agentLabel';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import type { LobeChatDatabase } from '@/database/type';
import { agentRouter } from '@/server/routers/lambda/agent';
import { agentLabelRouter } from '@/server/routers/lambda/agentLabel';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { rethrowCallerError } from '../helpers/trpc-caller';
import type { AgentDetailResponse } from '../types/agent.type';
import type {
  AgentPinState,
  AgentVisibilityState,
  AttachAgentFilesRequest,
  AttachAgentKnowledgeBaseRequest,
  ResourceTransferResult,
  TransferAgentRequest,
  UpdateAgentVisibilityRequest,
} from '../types/agent-advanced.type';
import type { PublicAgentLabel } from '../types/agent-label.type';
import { AgentService } from './agent.service';
import { AgentLabelRestService, projectPublicAgentLabel } from './agent-label.service';

type AgentKnowledge = Required<Pick<AgentDetailResponse, 'files' | 'knowledgeBases'>>;

/**
 * Agent configuration beyond plain CRUD: mounted knowledge, slug lookup, pin,
 * labels, visibility and transfer.
 *
 * Each write goes through the `agent` / `agentLabel` tRPC procedures (called
 * server-side), so REST keeps their rules: per-agent edit / transfer
 * permission in a workspace, team-pin owner/admin gate, builtin-agent and
 * dependent-task guards on demotion, transfer-request flow and history
 * migration. Before any procedure runs, the agent is resolved with the
 * caller's own scope (`AgentModel.existsById`: personal = created by the
 * caller, workspace = visible to them in `X-Workspace-Id`), so another
 * account's or workspace's agent reads as 404 rather than being written to.
 */
export class AgentAdvancedService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };
  private readonly agentModel: AgentModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
    this.agentModel = new AgentModel(db, this.userId, workspaceId);
  }

  private get agent() {
    return agentRouter.createCaller(this.ctx);
  }

  private get labels() {
    return agentLabelRouter.createCaller(this.ctx);
  }

  private fail(operation: string) {
    return (error: unknown): never =>
      rethrowCallerError(error, (cause) => this.handleServiceError(cause, operation));
  }

  private async assertAgentVisible(agentId: string) {
    if (!(await this.agentModel.existsById(agentId))) {
      throw this.createNotFoundError('Agent not found');
    }
  }

  // ==================== Slug ====================

  async getAgentBySlug(slug: string): Promise<AgentDetailResponse> {
    const { agentId } = await this.agent
      .resolveAgentIdBySlug({ slug })
      .catch(this.fail('resolve agent slug'));
    const agent = agentId
      ? await new AgentService(this.db, this.userId, this.workspaceId).getAgentById(agentId)
      : null;
    if (!agent) throw this.createNotFoundError('Agent not found');
    return agent;
  }

  // ==================== Knowledge ====================

  async getKnowledge(agentId: string): Promise<AgentKnowledge> {
    // Scope first: `getAgentById` answers an out-of-scope id with 403, which
    // would tell the caller the agent exists.
    await this.assertAgentVisible(agentId);
    const agent = await new AgentService(this.db, this.userId, this.workspaceId).getAgentById(
      agentId,
    );
    if (!agent) throw this.createNotFoundError('Agent not found');
    return { files: agent.files ?? [], knowledgeBases: agent.knowledgeBases ?? [] };
  }

  async attachFiles(agentId: string, request: AttachAgentFilesRequest): Promise<AgentKnowledge> {
    await this.assertAgentVisible(agentId);

    // The procedure inserts the junction rows as given; resolve every file in
    // the caller's own scope first so another account's file cannot be mounted.
    // A public workspace agent may only mount workspace-shared files — the
    // same `callerAgentVisibility` rule the product's knowledge picker applies.
    const fileModel = new FileModel(this.db, this.userId, this.workspaceId);
    const publicAgent =
      !!this.workspaceId && (await this.agentModel.getAgentVisibility(agentId)) === 'public';
    const fileIds = [...new Set(request.fileIds)];
    const found = await Promise.all(fileIds.map((id) => fileModel.findById(id)));
    const missing = fileIds.filter((_, index) => {
      const file = found[index];
      return !file || (publicAgent && file.visibility === 'private');
    });
    if (missing.length > 0) throw this.createNotFoundError(`File not found: ${missing.join(', ')}`);

    await this.agent
      .createAgentFiles({ agentId, enabled: request.enabled, fileIds })
      .catch(this.fail('attach agent files'));
    return this.getKnowledge(agentId);
  }

  async updateFile(agentId: string, fileId: string, enabled: boolean): Promise<AgentKnowledge> {
    await this.assertMounted(agentId, 'file', fileId);
    await this.agent.toggleFile({ agentId, enabled, fileId }).catch(this.fail('toggle agent file'));
    return this.getKnowledge(agentId);
  }

  async detachFile(agentId: string, fileId: string): Promise<AgentKnowledge> {
    await this.assertMounted(agentId, 'file', fileId);
    await this.agent.deleteAgentFile({ agentId, fileId }).catch(this.fail('detach agent file'));
    return this.getKnowledge(agentId);
  }

  async attachKnowledgeBase(
    agentId: string,
    request: AttachAgentKnowledgeBaseRequest,
  ): Promise<AgentKnowledge> {
    await this.assertAgentVisible(agentId);

    // A public agent may only mount shared knowledge — the same filter the
    // product's knowledge picker applies through `callerAgentVisibility`.
    const agentVisibility = await this.agentModel.getAgentVisibility(agentId);
    const knowledgeBase = await new KnowledgeBaseModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findById(request.knowledgeBaseId, agentVisibility);
    if (!knowledgeBase) throw this.createNotFoundError('Knowledge base not found');

    const current = await this.getKnowledge(agentId);
    if (current.knowledgeBases.some((item) => item.id === request.knowledgeBaseId)) {
      throw this.createConflictError('Knowledge base is already mounted on this agent');
    }

    await this.agent
      .createAgentKnowledgeBase({
        agentId,
        enabled: request.enabled,
        knowledgeBaseId: request.knowledgeBaseId,
      })
      .catch(this.fail('attach agent knowledge base'));
    return this.getKnowledge(agentId);
  }

  async updateKnowledgeBase(
    agentId: string,
    knowledgeBaseId: string,
    enabled: boolean,
  ): Promise<AgentKnowledge> {
    await this.assertMounted(agentId, 'knowledgeBase', knowledgeBaseId);
    await this.agent
      .toggleKnowledgeBase({ agentId, enabled, knowledgeBaseId })
      .catch(this.fail('toggle agent knowledge base'));
    return this.getKnowledge(agentId);
  }

  async detachKnowledgeBase(agentId: string, knowledgeBaseId: string): Promise<AgentKnowledge> {
    await this.assertMounted(agentId, 'knowledgeBase', knowledgeBaseId);
    await this.agent
      .deleteAgentKnowledgeBase({ agentId, knowledgeBaseId })
      .catch(this.fail('detach agent knowledge base'));
    return this.getKnowledge(agentId);
  }

  private async assertMounted(agentId: string, kind: 'file' | 'knowledgeBase', id: string) {
    const knowledge = await this.getKnowledge(agentId);
    const items = kind === 'file' ? knowledge.files : knowledge.knowledgeBases;
    if (!items.some((item) => item.id === id)) {
      throw this.createNotFoundError(
        kind === 'file'
          ? 'File is not mounted on this agent'
          : 'Knowledge base is not mounted on this agent',
      );
    }
  }

  // ==================== Pin ====================

  async setPinned(agentId: string, pinned: boolean): Promise<AgentPinState> {
    await this.assertAgentVisible(agentId);
    await this.agent.updateAgentPinned({ id: agentId, pinned }).catch(this.fail('pin agent'));
    return { id: agentId, pinned };
  }

  // ==================== Labels ====================

  async getAgentLabels(agentId: string): Promise<PublicAgentLabel[]> {
    await this.assertAgentVisible(agentId);
    return this.readAgentLabels(agentId);
  }

  /** The agent's labels with fresh usage counts; the agent is already resolved in scope. */
  private async readAgentLabels(agentId: string): Promise<PublicAgentLabel[]> {
    const [assignedIds, registry] = await Promise.all([
      new AgentLabelModel(this.db, this.userId, this.workspaceId).getAgentLabelIds(agentId),
      this.labelRegistry(),
    ]);
    const assigned = new Set(assignedIds);
    return registry.filter((label) => assigned.has(label.id)).map(projectPublicAgentLabel);
  }

  private labelRegistry() {
    return new AgentLabelRestService(this.db, this.userId, this.workspaceId).queryAll();
  }

  async setAgentLabels(agentId: string, labelIds: string[]): Promise<PublicAgentLabel[]> {
    await this.assertAgentVisible(agentId);
    await this.assertLabelsInScope(labelIds);
    await this.labels
      .setAgentLabels({ agentId, labelIds: [...new Set(labelIds)] })
      .catch(this.fail('set agent labels'));
    return this.readAgentLabels(agentId);
  }

  async toggleAgentLabel(
    agentId: string,
    labelId: string,
    assigned: boolean,
  ): Promise<PublicAgentLabel[]> {
    await this.assertAgentVisible(agentId);
    const [label] = await this.assertLabelsInScope([labelId]);
    if (assigned && label.archived) {
      throw this.createValidationError('An archived label cannot be newly assigned');
    }
    await this.labels
      .toggleAgentLabel({ agentId, assigned, labelId })
      .catch(this.fail('toggle agent label'));
    return this.readAgentLabels(agentId);
  }

  private async assertLabelsInScope(labelIds: string[]) {
    const registry = await this.labelRegistry();
    const byId = new Map(registry.map((label) => [label.id, label]));
    const missing = labelIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw this.createNotFoundError(`Agent label not found: ${missing.join(', ')}`);
    }
    return labelIds.map((id) => byId.get(id)!);
  }

  // ==================== Visibility ====================

  async setVisibility(
    agentId: string,
    request: UpdateAgentVisibilityRequest,
  ): Promise<AgentVisibilityState> {
    await this.assertAgentVisible(agentId);
    return this.agent
      .setAgentVisibility({
        accessLevel: request.accessLevel,
        id: agentId,
        visibility: request.visibility,
      })
      .catch(this.fail('set agent visibility'));
  }

  // ==================== Transfer ====================

  /**
   * `viaApiKey`: an API key is bound to one scope (a personal key to the
   * personal space, a workspace key to its workspace — see the workspace
   * middleware). A move to another workspace or to the personal space would
   * write outside that binding, which the procedure cannot see because it
   * only checks the user's own rights in the target. Keys may therefore only
   * hand an agent to another member of their own workspace.
   */
  async transfer(
    agentId: string,
    request: TransferAgentRequest,
    { viaApiKey = false }: { viaApiKey?: boolean } = {},
  ): Promise<ResourceTransferResult> {
    if (viaApiKey && request.targetWorkspaceId !== undefined) {
      throw new ApiException(
        403,
        'forbidden',
        'An API key cannot move an agent out of the scope it is bound to; use targetMemberId to hand it to another member of this workspace, or move it in the product',
      );
    }
    await this.assertAgentVisible(agentId);
    const result = await this.agent
      .transferAgent({
        agentId,
        targetAccessLevel: request.targetAccessLevel,
        targetMemberId: request.targetMemberId,
        targetVisibility: request.targetVisibility,
        targetWorkspaceId: request.targetWorkspaceId ?? null,
      })
      .catch(this.fail('transfer agent'));

    if ('status' in result) {
      return {
        id: agentId,
        requestId: result.requestId,
        slug: null,
        status: 'pending',
        transferJobId: null,
      };
    }
    return {
      id: result.agentId,
      requestId: null,
      slug: result.slug,
      status: 'transferred',
      transferJobId: result.transferJobId,
    };
  }
}
