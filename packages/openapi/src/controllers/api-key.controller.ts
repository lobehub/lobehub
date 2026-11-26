import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import type { LegacyArrayListQuery } from '../helpers/legacy-array-list';
import { pageLoadedList } from '../helpers/legacy-array-list';
import { ApiKeyService } from '../services/api-key.service';
import type { CreateApiKeyRequest, UpdateApiKeyRequest } from '../types/api-key.type';

export class ApiKeyController extends BaseController {
  private async getService(c: Context) {
    const db = await this.getDatabase();
    return new ApiKeyService(db, this.getUserId(c)!, this.getWorkspaceId(c));
  }

  async createApiKey(c: Context) {
    try {
      const service = await this.getService(c);
      const result = await service.createApiKey((await this.getBody<CreateApiKeyRequest>(c))!);
      return this.success(c, result, 'API key created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getApiKeys(c: Context) {
    try {
      const service = await this.getService(c);
      return this.success(
        c,
        pageLoadedList(await service.getApiKeys(), this.getQuery<LegacyArrayListQuery>(c)),
        'API keys retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getApiKey(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.getService(c);
      return this.success(c, await service.getApiKey(id), 'API key retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async updateApiKey(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const request = (await this.getBody<UpdateApiKeyRequest>(c))!;
      const service = await this.getService(c);
      return this.success(c, await service.updateApiKey(id, request), 'API key updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async deleteApiKey(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.getService(c);
      return this.success(c, await service.deleteApiKey(id), 'API key deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
