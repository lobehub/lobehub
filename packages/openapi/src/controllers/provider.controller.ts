import type { Context } from 'hono';

import { isFullAccessApiKey } from '@/const/apiKeyScope';

import { BaseController } from '../common/base.controller';
import { ProviderService } from '../services/provider.service';
import type {
  CreateProviderRequest,
  DeleteProviderRequest,
  GetProviderDetailRequest,
  ProviderIdParam,
  ProviderListQuery,
  UpdateProviderRequest,
  UpdateProviderRequestBody,
} from '../types/provider.type';

/**
 * Provider controller, responsible for handling Provider-related HTTP requests
 */
export class ProviderController extends BaseController {
  /**
   * Restricted API keys must not exfiltrate decrypted provider credentials
   * through the read endpoints.
   */
  private isRestrictedApiKey(c: Context): boolean {
    if (c.get('authType') !== 'apikey') return false;

    return !isFullAccessApiKey(c.get('apiKeyScopes') as string[] | null | undefined);
  }

  async handleGetProviders(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<ProviderListQuery>(c);
      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c), this.getWorkspaceId(c));

      const result = await providerService.getProviders(query);

      if (result?.providers && this.isRestrictedApiKey(c)) {
        result.providers = result.providers.map((provider) => ({
          ...provider,
          keyVaults: undefined,
        }));
      }

      return this.success(c, result, 'Provider list retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async handleGetProvider(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<ProviderIdParam>(c);
      const request: GetProviderDetailRequest = { id };

      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c), this.getWorkspaceId(c));
      const provider = await providerService.getProviderDetail(request);

      if (provider && this.isRestrictedApiKey(c)) {
        return this.success(
          c,
          { ...provider, keyVaults: undefined },
          'Provider details retrieved successfully',
        );
      }

      return this.success(c, provider, 'Provider details retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async handleCreateProvider(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateProviderRequest>(c);

      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c), this.getWorkspaceId(c));
      const created = await providerService.createProvider({ ...body, source: 'custom' });

      return this.success(
        c,
        created && this.isRestrictedApiKey(c) ? { ...created, keyVaults: undefined } : created,
        'Provider created successfully',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async handleUpdateProvider(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<ProviderIdParam>(c);
      const body = await this.getBody<UpdateProviderRequestBody>(c);

      const request: UpdateProviderRequest = {
        ...body,
        id,
      };

      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c), this.getWorkspaceId(c));
      const updated = await providerService.updateProvider(request);

      return this.success(
        c,
        updated && this.isRestrictedApiKey(c) ? { ...updated, keyVaults: undefined } : updated,
        'Provider updated successfully',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async handleDeleteProvider(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<ProviderIdParam>(c);
      const request: DeleteProviderRequest = { id };

      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c), this.getWorkspaceId(c));
      const result = await providerService.deleteProvider(request);

      return this.success(c, result, 'Provider deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
