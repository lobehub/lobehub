import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { MemoryRestService } from '../services/memory.service';
import type { MemoryCategory, MemoryEntryIdParam } from '../types/memory.type';

/** User memory controller — read the persona, inspect and prune memory entries. */
export class MemoryController extends BaseController {
  private async service(c: Context): Promise<MemoryRestService> {
    return new MemoryRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/memories/persona */
  async getPersona(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      return this.success(c, await service.getPersona(), 'Persona retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/memories/persona/versions */
  async listPersonaVersions(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      return this.success(c, await service.listPersonaVersions(), 'Persona versions retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/memories/:category */
  async listCategory(c: Context): Promise<Response> {
    try {
      const { category } = this.getParams<{ category: MemoryCategory }>(c);
      const service = await this.service(c);
      return this.success(c, await service.listCategory(category), `${category} retrieved`);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/memories/:category/:id */
  async deleteEntry(c: Context): Promise<Response> {
    try {
      const { category, id } = this.getParams<MemoryEntryIdParam & { category: MemoryCategory }>(c);
      const service = await this.service(c);
      await service.deleteEntry(category, id);
      return this.success(c, undefined, 'Memory entry deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/memories */
  async deleteAll(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      await service.deleteAll();
      return this.success(c, undefined, 'All memories deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
