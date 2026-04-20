import type { Context } from 'hono';

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
  async handleGetProviders(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<ProviderListQuery>(c);
      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c));

      const result = await providerService.getProviders(query);

      return this.success(c, result, '获取 Provider 列表成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async handleGetProvider(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<ProviderIdParam>(c);
      const request: GetProviderDetailRequest = { id };

      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c));
      const provider = await providerService.getProviderDetail(request);

      return this.success(c, provider, '获取 Provider 详情成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async handleCreateProvider(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateProviderRequest>(c);

      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c));
      const created = await providerService.createProvider({ ...body, source: 'custom' });

      return this.success(c, created, '创建 Provider 成功');
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
      const providerService = new ProviderService(db, this.getUserId(c));
      const updated = await providerService.updateProvider(request);

      return this.success(c, updated, '更新 Provider 成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async handleDeleteProvider(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<ProviderIdParam>(c);
      const request: DeleteProviderRequest = { id };

      const db = await this.getDatabase();
      const providerService = new ProviderService(db, this.getUserId(c));
      const result = await providerService.deleteProvider(request);

      return this.success(c, result, '删除 Provider 成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
