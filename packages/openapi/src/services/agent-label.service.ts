import type { AgentLabelWithUsage } from '@/database/models/agentLabel';
import type { LobeChatDatabase } from '@/database/type';
import { agentLabelRouter } from '@/server/routers/lambda/agentLabel';

import { BaseService } from '../common/base.service';
import type { PaginationRequest } from '../helpers/pagination';
import { resolvePagination } from '../helpers/pagination';
import { rethrowCallerError } from '../helpers/trpc-caller';
import type {
  CreateAgentLabelRequest,
  PublicAgentLabel,
  UpdateAgentLabelRequest,
} from '../types/agent-label.type';
import type { DeletedResource } from '../types/common.type';

const toIso = (value: Date | string) => new Date(value).toISOString();

export const projectPublicAgentLabel = (label: AgentLabelWithUsage): PublicAgentLabel => ({
  archived: label.archived,
  color: label.color ?? null,
  createdAt: toIso(label.createdAt),
  description: label.description ?? null,
  id: label.id,
  name: label.name,
  updatedAt: toIso(label.updatedAt),
  usageCount: Number(label.usageCount),
});

/**
 * Agent label registry over REST.
 *
 * Every call goes through the `agentLabel` tRPC procedures (server-side
 * caller), so REST shares their hex-only colour rule, duplicate-name CONFLICT
 * and the workspace-shared / personal ownership predicate of `AgentLabelModel`.
 * A label in another account or workspace is simply not in the caller's
 * registry and reads as 404.
 */
export class AgentLabelRestService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private get labels() {
    return agentLabelRouter.createCaller({ userId: this.userId, workspaceId: this.workspaceId });
  }

  /** Every label in the caller's scope, with usage counts limited to agents they can see. */
  async queryAll(): Promise<AgentLabelWithUsage[]> {
    try {
      return await this.labels.getLabels();
    } catch (error) {
      return rethrowCallerError(error, (e) => this.handleServiceError(e, 'list agent labels'));
    }
  }

  async listLabels(
    request: PaginationRequest,
  ): Promise<{ items: PublicAgentLabel[]; total: number }> {
    const all = await this.queryAll();
    const { limit, offset } = resolvePagination(request);
    return {
      items: all.slice(offset, offset + limit).map(projectPublicAgentLabel),
      total: all.length,
    };
  }

  async getLabel(id: string): Promise<PublicAgentLabel> {
    const label = (await this.queryAll()).find((item) => item.id === id);
    if (!label) throw this.createNotFoundError('Agent label not found');
    return projectPublicAgentLabel(label);
  }

  async createLabel(request: CreateAgentLabelRequest): Promise<PublicAgentLabel> {
    let id: string | undefined;
    try {
      id = await this.labels.createLabel(request);
    } catch (error) {
      rethrowCallerError(error, (e) => this.handleServiceError(e, 'create agent label'));
    }
    if (!id) throw this.createBusinessError('Agent label was not created');
    return this.getLabel(id);
  }

  async updateLabel(id: string, value: UpdateAgentLabelRequest): Promise<PublicAgentLabel> {
    await this.getLabel(id);
    try {
      await this.labels.updateLabel({ id, value });
    } catch (error) {
      rethrowCallerError(error, (e) => this.handleServiceError(e, 'update agent label'));
    }
    return this.getLabel(id);
  }

  async deleteLabel(id: string): Promise<DeletedResource> {
    await this.getLabel(id);
    try {
      await this.labels.removeLabel({ id });
    } catch (error) {
      rethrowCallerError(error, (e) => this.handleServiceError(e, 'delete agent label'));
    }
    return { deleted: true, id };
  }
}
