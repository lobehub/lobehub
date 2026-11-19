import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { SkillRestService } from '../services/skill.service';
import type {
  CreateSkillRequest,
  ImportSkillRequest,
  SkillListQuery,
  UpdateSkillRequest,
} from '../types/skill.type';

export class SkillController extends BaseController {
  private async getService(c: Context) {
    const db = await this.getDatabase();
    return new SkillRestService(
      db,
      this.getUserId(c),
      this.getWorkspaceId(c),
      c.get('workspaceRole') || undefined,
    );
  }

  async listSkills(c: Context) {
    try {
      const query = this.getQuery<SkillListQuery>(c);
      return this.success(
        c,
        await (await this.getService(c)).listSkills(query),
        'Skills retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getSkill(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(c, await (await this.getService(c)).getSkill(id), 'Skill retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async createSkill(c: Context) {
    try {
      const body = await this.getBody<CreateSkillRequest>(c);
      const data = await (await this.getService(c)).createSkill(body);
      return this.success(c, data, 'Skill created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async importSkill(c: Context) {
    try {
      const body = await this.getBody<ImportSkillRequest>(c);
      const data = await (await this.getService(c)).importSkill(body);
      return this.success(c, data, 'Skill imported');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async updateSkill(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateSkillRequest>(c);
      return this.success(
        c,
        await (await this.getService(c)).updateSkill(id, body),
        'Skill updated',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async deleteSkill(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(c, await (await this.getService(c)).deleteSkill(id), 'Skill deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listResources(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).listResources(id),
        'Skill resources retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async readResource(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const { path } = this.getQuery<{ path: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).readResource(id, path),
        'Skill resource retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
