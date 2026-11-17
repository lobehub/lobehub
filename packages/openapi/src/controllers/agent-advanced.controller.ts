import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { AgentAdvancedService } from '../services/agent-advanced.service';
import type {
  AttachAgentFilesRequest,
  AttachAgentKnowledgeBaseRequest,
  SetAgentLabelsRequest,
  TransferAgentRequest,
  UpdateAgentVisibilityRequest,
} from '../types/agent-advanced.type';

type AgentParams = { fileId?: string; id: string; knowledgeBaseId?: string; labelId?: string };

/**
 * Agent knowledge, slug, pin, labels, visibility and transfer.
 * HTTP concerns only — the rules live in the shared `agent` procedures.
 */
export class AgentAdvancedController extends BaseController {
  private async run<T>(
    c: Context,
    action: (service: AgentAdvancedService, params: AgentParams) => Promise<T>,
    message: string,
    status = 200,
  ): Promise<Response> {
    try {
      const service = new AgentAdvancedService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await action(service, this.getParams<AgentParams>(c)),
        message,
        status,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/agents/by-slug/:slug */
  getAgentBySlug(c: Context) {
    const { slug } = this.getParams<{ slug: string }>(c);
    return this.run(c, (service) => service.getAgentBySlug(slug), 'Agent retrieved');
  }

  /** GET /api/v1/agents/:id/knowledge */
  getKnowledge(c: Context) {
    return this.run(c, (service, { id }) => service.getKnowledge(id), 'Agent knowledge retrieved');
  }

  /** POST /api/v1/agents/:id/knowledge/files */
  async attachFiles(c: Context) {
    const body = await this.getBody<AttachAgentFilesRequest>(c);
    return this.run(c, (service, { id }) => service.attachFiles(id, body), 'Files mounted');
  }

  /** PATCH /api/v1/agents/:id/knowledge/files/:fileId */
  async updateFile(c: Context) {
    const { enabled } = await this.getBody<{ enabled: boolean }>(c);
    return this.run(
      c,
      (service, { fileId, id }) => service.updateFile(id, fileId!, enabled),
      'File updated',
    );
  }

  /** DELETE /api/v1/agents/:id/knowledge/files/:fileId */
  detachFile(c: Context) {
    return this.run(
      c,
      (service, { fileId, id }) => service.detachFile(id, fileId!),
      'File unmounted',
    );
  }

  /** POST /api/v1/agents/:id/knowledge/knowledge-bases */
  async attachKnowledgeBase(c: Context) {
    const body = await this.getBody<AttachAgentKnowledgeBaseRequest>(c);
    return this.run(
      c,
      (service, { id }) => service.attachKnowledgeBase(id, body),
      'Knowledge base mounted',
    );
  }

  /** PATCH /api/v1/agents/:id/knowledge/knowledge-bases/:knowledgeBaseId */
  async updateKnowledgeBase(c: Context) {
    const { enabled } = await this.getBody<{ enabled: boolean }>(c);
    return this.run(
      c,
      (service, { id, knowledgeBaseId }) =>
        service.updateKnowledgeBase(id, knowledgeBaseId!, enabled),
      'Knowledge base updated',
    );
  }

  /** DELETE /api/v1/agents/:id/knowledge/knowledge-bases/:knowledgeBaseId */
  detachKnowledgeBase(c: Context) {
    return this.run(
      c,
      (service, { id, knowledgeBaseId }) => service.detachKnowledgeBase(id, knowledgeBaseId!),
      'Knowledge base unmounted',
    );
  }

  /** POST /api/v1/agents/:id/pin */
  async setPinned(c: Context) {
    const { pinned = true } = await this.getBody<{ pinned?: boolean }>(c);
    return this.run(
      c,
      (service, { id }) => service.setPinned(id, pinned),
      pinned ? 'Agent pinned' : 'Agent unpinned',
    );
  }

  /** GET /api/v1/agents/:id/labels */
  getLabels(c: Context) {
    return this.run(
      c,
      async (service, { id }) => ({ items: await service.getAgentLabels(id) }),
      'Agent labels retrieved',
    );
  }

  /** PUT /api/v1/agents/:id/labels */
  async setLabels(c: Context) {
    const { labelIds } = await this.getBody<SetAgentLabelsRequest>(c);
    return this.run(
      c,
      async (service, { id }) => ({ items: await service.setAgentLabels(id, labelIds) }),
      'Agent labels updated',
    );
  }

  /** PUT /api/v1/agents/:id/labels/:labelId */
  addLabel(c: Context) {
    return this.run(
      c,
      async (service, { id, labelId }) => ({
        items: await service.toggleAgentLabel(id, labelId!, true),
      }),
      'Agent label added',
    );
  }

  /** DELETE /api/v1/agents/:id/labels/:labelId */
  removeLabel(c: Context) {
    return this.run(
      c,
      async (service, { id, labelId }) => ({
        items: await service.toggleAgentLabel(id, labelId!, false),
      }),
      'Agent label removed',
    );
  }

  /** PATCH /api/v1/agents/:id/visibility */
  async setVisibility(c: Context) {
    const body = await this.getBody<UpdateAgentVisibilityRequest>(c);
    return this.run(
      c,
      (service, { id }) => service.setVisibility(id, body),
      'Agent visibility updated',
    );
  }

  /** POST /api/v1/agents/:id/transfer */
  async transfer(c: Context) {
    const body = await this.getBody<TransferAgentRequest>(c);
    const viaApiKey = c.get('authType') === 'apikey';
    return this.run(
      c,
      (service, { id }) => service.transfer(id, body, { viaApiKey }),
      'Agent transfer started',
    );
  }
}
