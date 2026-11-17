import { explicitScopesBeyondIssuer } from '@lobechat/const';
import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ApiException } from '../common/errors';
import type { LegacyArrayListQuery } from '../helpers/legacy-array-list';
import { pageLoadedList } from '../helpers/legacy-array-list';
import { ApiKeyService } from '../services/api-key.service';
import type { CreateApiKeyRequest, UpdateApiKeyRequest } from '../types/api-key.type';

export class ApiKeyController extends BaseController {
  /**
   * An API key may not hand out an explicit scope (`device:operate`) it does
   * not hold itself: full access never carried one, so minting a key with it
   * would be an escalation. (Scopes cannot be changed through `PATCH`.)
   */
  private assertGrantable(c: Context, scopes: string[] | null | undefined) {
    if (c.get('authType') !== 'apikey') return;

    const beyond = explicitScopesBeyondIssuer(scopes, c.get('apiKeyScopes'));
    if (beyond.length > 0) {
      throw new ApiException(
        403,
        'forbidden',
        `insufficient_scope: an API key cannot grant a scope it does not hold: ${beyond.join(', ')}`,
      );
    }
  }

  private async getService(c: Context) {
    const db = await this.getDatabase();
    return new ApiKeyService(db, this.getUserId(c)!, this.getWorkspaceId(c));
  }

  async createApiKey(c: Context) {
    try {
      const request = (await this.getBody<CreateApiKeyRequest>(c))!;
      this.assertGrantable(c, request.scopes);
      const service = await this.getService(c);
      const result = await service.createApiKey(request);
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
