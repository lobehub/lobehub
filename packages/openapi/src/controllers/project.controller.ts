import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ProjectRestService } from '../services/project.service';
import type { ProjectListQuery } from '../types/project.type';

type Params = { agentId: string; id: string; knowledgeBaseId: string; workId: string };

/**
 * Projects controller.
 * Handles HTTP concerns only — the project rules live in the shared `project` procedures.
 */
export class ProjectController extends BaseController {
  private async respond<T>(
    c: Context,
    work: (service: ProjectRestService, params: Params) => Promise<T>,
    message: string,
    status = 200,
  ): Promise<Response> {
    try {
      const service = new ProjectRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      return this.success(c, await work(service, this.getParams<Params>(c)), message, status);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listProjects(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<ProjectListQuery>(c);
      const service = new ProjectRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      return this.list(c, 'items', await service.listProjects(query), {
        message: 'Projects retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async createProject(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s) => s.createProject(body), 'Project created', 201);
  }

  async getProject(c: Context) {
    return this.respond(c, (s, p) => s.getProject(p.id), 'Project retrieved');
  }

  async updateProject(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.updateProject(p.id, body), 'Project updated');
  }

  async deleteProject(c: Context) {
    return this.respond(c, (s, p) => s.deleteProject(p.id), 'Project deleted');
  }

  async updateStatus(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.updateStatus(p.id, body), 'Project status updated');
  }

  async listAgents(c: Context) {
    return this.respond(c, (s, p) => s.listAgents(p.id), 'Project agents retrieved');
  }

  async addAgent(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.addAgent(p.id, body), 'Agent added to project', 201);
  }

  async updateAgent(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.updateAgent(p.id, p.agentId, body), 'Project agent updated');
  }

  async removeAgent(c: Context) {
    return this.respond(c, (s, p) => s.removeAgent(p.id, p.agentId), 'Agent removed from project');
  }

  async listKnowledgeBases(c: Context) {
    return this.respond(
      c,
      (s, p) => s.listKnowledgeBases(p.id),
      'Project knowledge bases retrieved',
    );
  }

  async addKnowledgeBase(c: Context) {
    const body = await this.getBody(c);
    return this.respond(
      c,
      (s, p) => s.addKnowledgeBase(p.id, body),
      'Knowledge base added to project',
      201,
    );
  }

  async updateKnowledgeBase(c: Context) {
    const body = await this.getBody(c);
    return this.respond(
      c,
      (s, p) => s.updateKnowledgeBase(p.id, p.knowledgeBaseId, body),
      'Project knowledge base updated',
    );
  }

  async removeKnowledgeBase(c: Context) {
    return this.respond(
      c,
      (s, p) => s.removeKnowledgeBase(p.id, p.knowledgeBaseId),
      'Knowledge base removed from project',
    );
  }

  async listWorks(c: Context) {
    return this.respond(c, (s, p) => s.listWorks(p.id), 'Project works retrieved');
  }

  async addWork(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.addWork(p.id, body), 'Work added to project', 201);
  }

  async removeWork(c: Context) {
    return this.respond(c, (s, p) => s.removeWork(p.id, p.workId), 'Work removed from project');
  }

  async listCompletionReviews(c: Context) {
    return this.respond(c, (s, p) => s.listCompletionReviews(p.id), 'Completion reviews retrieved');
  }

  async requestCompletion(c: Context) {
    return this.respond(c, (s, p) => s.requestCompletion(p.id), 'Project completion requested');
  }

  async reviewCompletion(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.reviewCompletion(p.id, body), 'Project completion reviewed');
  }

  async reopen(c: Context) {
    return this.respond(c, (s, p) => s.reopen(p.id), 'Project reopened');
  }
}
