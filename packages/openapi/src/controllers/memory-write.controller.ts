import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { MemoryWriteRestService } from '../services/memory-write.service';
import type {
  CreateMemoryActivity,
  CreateMemoryContext,
  CreateMemoryExperience,
  CreateMemoryIdentity,
  CreateMemoryPreference,
  MemorySearchRequest,
  StartMemoryExtraction,
  UpdateMemoryActivity,
  UpdateMemoryContext,
  UpdateMemoryExperience,
  UpdateMemoryIdentity,
  UpdateMemoryPreference,
} from '../types/memory-write.type';

/** The memory layers a client can write, keyed by their path segment. */
export type WritableMemoryCategory =
  'activities' | 'contexts' | 'experiences' | 'identities' | 'preferences';

type Service = MemoryWriteRestService;

/** Each layer's create call; the route has already validated the body against its schema. */
const CREATE: Record<WritableMemoryCategory, (service: Service, body: any) => Promise<unknown>> = {
  activities: (service, body: CreateMemoryActivity) => service.createActivity(body),
  contexts: (service, body: CreateMemoryContext) => service.createContext(body),
  experiences: (service, body: CreateMemoryExperience) => service.createExperience(body),
  identities: (service, body: CreateMemoryIdentity) => service.createIdentity(body),
  preferences: (service, body: CreateMemoryPreference) => service.createPreference(body),
};

const UPDATE: Record<
  WritableMemoryCategory,
  (service: Service, id: string, body: any) => Promise<unknown>
> = {
  activities: (service, id, body: UpdateMemoryActivity) => service.updateActivity(id, body),
  contexts: (service, id, body: UpdateMemoryContext) => service.updateContext(id, body),
  experiences: (service, id, body: UpdateMemoryExperience) => service.updateExperience(id, body),
  identities: (service, id, body: UpdateMemoryIdentity) => service.updateIdentity(id, body),
  preferences: (service, id, body: UpdateMemoryPreference) => service.updatePreference(id, body),
};

/** Memory writes, semantic memory search, extraction tasks and persona restore. */
export class MemoryWriteController extends BaseController {
  private async service(c: Context): Promise<MemoryWriteRestService> {
    return new MemoryWriteRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** POST /api/v1/memories/{category} */
  async createEntry(c: Context, category: WritableMemoryCategory): Promise<Response> {
    try {
      const body = await this.getBody(c);
      const entry = await CREATE[category](await this.service(c), body);
      return this.success(c, entry, 'Memory entry created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/memories/{category}/{id} */
  async updateEntry(c: Context, category: WritableMemoryCategory): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody(c);
      const entry = await UPDATE[category](await this.service(c), id, body);
      return this.success(c, entry, 'Memory entry updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/memories/search */
  async search(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<MemorySearchRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.search(body), 'Memories retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/memories/extractions */
  async startExtraction(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<StartMemoryExtraction>(c);
      const service = await this.service(c);
      return this.success(c, await service.startExtraction(body), 'Memory extraction queued', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/memories/extractions/{id} */
  async getExtraction(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.service(c);
      return this.success(c, await service.getExtraction(id), 'Memory extraction retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/memories/persona/versions/{id}/restore */
  async restorePersonaVersion(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.service(c);
      return this.success(c, await service.restorePersonaVersion(id), 'Persona version restored');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
