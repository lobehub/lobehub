import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ModelService } from '../services/model.service';
import type { CreateModelRequest, ModelsListQuery, UpdateModelRequest } from '../types/model.type';

export class ModelController extends BaseController {
  /**
   * Retrieves the model list endpoint
   * GET /api/v1/models
   * Query: { page?, pageSize?, keyword? }
   */
  async handleGetModels(c: Context) {
    try {
      const query = this.getQuery<ModelsListQuery>(c);

      const db = await this.getDatabase();
      const modelService = new ModelService(db, this.getUserId(c));

      const result = await modelService.getModels(query);

      return this.success(c, result, '获取模型列表成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves model details
   * GET /api/v1/models/:providerId/:modelId
   */
  async handleGetModel(c: Context) {
    try {
      const { providerId, modelId } = this.getParams<{ modelId: string; providerId: string }>(c);

      const db = await this.getDatabase();
      const modelService = new ModelService(db, this.getUserId(c));
      const result = await modelService.getModelDetail(providerId, modelId);

      return this.success(c, result, '获取模型详情成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates a model
   * POST /api/v1/models
   */
  async handleCreateModel(c: Context) {
    try {
      const body = await this.getBody<CreateModelRequest>(c);

      if (!body) {
        return this.error(c, '请求体不能为空', 400);
      }

      const db = await this.getDatabase();
      const modelService = new ModelService(db, this.getUserId(c));
      const result = await modelService.createModel(body);

      return this.success(c, result, '创建模型成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates a model
   * PATCH /api/v1/models/:providerId/:modelId
   */
  async handleUpdateModel(c: Context) {
    try {
      const { providerId, modelId } = this.getParams<{ modelId: string; providerId: string }>(c);
      const body = await this.getBody<UpdateModelRequest>(c);

      if (!body) {
        return this.error(c, '请求体不能为空', 400);
      }

      const db = await this.getDatabase();
      const modelService = new ModelService(db, this.getUserId(c));
      const result = await modelService.updateModel(providerId, modelId, body);

      return this.success(c, result, '更新模型成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
