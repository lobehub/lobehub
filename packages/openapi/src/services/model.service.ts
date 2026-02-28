import { and, asc, count, eq, ilike, or } from 'drizzle-orm';

import { aiModels } from '@/database/schemas';
import { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import { ServiceResult } from '../types';
import {
  CreateModelRequest,
  GetModelsResponse,
  ModelDetailResponse,
  ModelsListQuery,
  UpdateModelRequest,
} from '../types/model.type';

/**
 * 模型服务实现类 (Hono API 专用)
 * 提供模型的查询和分组功能
 */
export class ModelService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
  }

  /**
   * 获取模型列表
   * @param request 查询请求参数
   */
  async getModels(request: ModelsListQuery = {}): ServiceResult<GetModelsResponse> {
    this.log('info', '获取模型列表', {
      ...request,
      userId: this.userId,
    });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('AI_MODEL_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问模型列表');
      }

      // 构建查询条件
      const conditions = [];

      // 权限条件直接加入主条件数组
      if (permissionResult.condition?.userId) {
        conditions.push(eq(aiModels.userId, permissionResult.condition.userId));
      }

      // 处理 ModelsListQuery 特定参数
      const { page, pageSize, keyword, provider, type, enabled } = request;

      // 如果提供了关键词，添加到查询条件中
      if (keyword) {
        conditions.push(
          or(
            ilike(aiModels.id, `%${keyword}%`),
            ilike(aiModels.displayName, `%${keyword}%`),
            ilike(aiModels.description, `%${keyword}%`),
          ),
        );
      }

      if (provider) {
        conditions.push(eq(aiModels.providerId, provider));
      }

      if (type) {
        conditions.push(eq(aiModels.type, type));
      }

      if (typeof enabled === 'boolean') {
        conditions.push(eq(aiModels.enabled, enabled));
      }

      const finalWhereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      // 计算偏移量
      const { limit, offset } = processPaginationConditions({ page, pageSize });

      // 并行执行查询和计数
      const [result, totalResult] = await Promise.all([
        this.db.query.aiModels.findMany({
          limit,
          offset,
          orderBy: asc(aiModels.sort),
          where: finalWhereCondition,
        }),
        this.db.select({ count: count() }).from(aiModels).where(finalWhereCondition),
      ]);

      return {
        models: result,
        total: totalResult[0]?.count ?? 0,
      };
    } catch (error) {
      this.handleServiceError(error, '获取模型列表失败');
    }
  }

  /**
   * 获取模型详情
   */
  async getModelDetail(providerId: string, modelId: string): ServiceResult<ModelDetailResponse> {
    this.log('info', '获取模型详情', { modelId, providerId, userId: this.userId });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_MODEL_READ', {
        targetModelId: modelId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问模型详情');
      }

      const conditions = [eq(aiModels.providerId, providerId), eq(aiModels.id, modelId)];

      if (permissionResult.condition?.userId) {
        conditions.push(eq(aiModels.userId, permissionResult.condition.userId));
      }

      const model = await this.db.query.aiModels.findFirst({ where: and(...conditions) });

      if (!model) {
        throw this.createNotFoundError(`模型 ${providerId}/${modelId} 不存在`);
      }

      return model;
    } catch (error) {
      this.handleServiceError(error, '获取模型详情');
    }
  }

  /**
   * 创建模型
   */
  async createModel(payload: CreateModelRequest): ServiceResult<ModelDetailResponse> {
    this.log('info', '创建模型', { payload, userId: this.userId });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_MODEL_CREATE');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权创建模型');
      }

      if (!this.userId) {
        throw this.createAuthError('用户未认证');
      }

      return await this.db.transaction(async (tx) => {
        const existingModel = await tx.query.aiModels.findFirst({
          where: and(
            eq(aiModels.id, payload.id),
            eq(aiModels.providerId, payload.providerId),
            eq(aiModels.userId, this.userId),
          ),
        });

        if (existingModel) {
          throw this.createBusinessError(`模型 ${payload.providerId}/${payload.id} 已存在`);
        }

        const [created] = await tx
          .insert(aiModels)
          .values({
            abilities: payload.abilities ?? {},
            config: payload.config ?? null,
            contextWindowTokens: payload.contextWindowTokens ?? null,
            description: payload.description ?? null,
            displayName: payload.displayName,
            enabled: payload.enabled ?? true,
            id: payload.id,
            organization: payload.organization ?? null,
            parameters: payload.parameters ?? {},
            pricing: payload.pricing ?? null,
            providerId: payload.providerId,
            releasedAt: payload.releasedAt ?? null,
            sort: payload.sort ?? null,
            source: payload.source ?? null,
            type: payload.type ?? 'chat',
            userId: this.userId,
          })
          .returning();

        return created;
      });
    } catch (error) {
      this.handleServiceError(error, '创建模型');
    }
  }

  /**
   * 更新模型
   */
  async updateModel(
    providerId: string,
    modelId: string,
    payload: UpdateModelRequest,
  ): ServiceResult<ModelDetailResponse> {
    this.log('info', '更新模型', { modelId, payload, providerId, userId: this.userId });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_MODEL_UPDATE', {
        targetModelId: modelId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权更新模型');
      }

      const conditions = [eq(aiModels.providerId, providerId), eq(aiModels.id, modelId)];
      if (permissionResult.condition?.userId) {
        conditions.push(eq(aiModels.userId, permissionResult.condition.userId));
      }

      return await this.db.transaction(async (tx) => {
        const existingModel = await tx.query.aiModels.findFirst({ where: and(...conditions) });

        if (!existingModel) {
          throw this.createNotFoundError(`模型 ${providerId}/${modelId} 不存在`);
        }

        const updateFields = {
          ...(payload.abilities !== undefined && { abilities: payload.abilities }),
          ...(payload.config !== undefined && { config: payload.config }),
          ...(payload.contextWindowTokens !== undefined && {
            contextWindowTokens: payload.contextWindowTokens,
          }),
          ...(payload.description !== undefined && { description: payload.description }),
          ...(payload.displayName !== undefined && { displayName: payload.displayName }),
          ...(payload.enabled !== undefined && { enabled: payload.enabled }),
          ...(payload.organization !== undefined && { organization: payload.organization }),
          ...(payload.parameters !== undefined && { parameters: payload.parameters }),
          ...(payload.pricing !== undefined && { pricing: payload.pricing }),
          ...(payload.releasedAt !== undefined && { releasedAt: payload.releasedAt }),
          ...(payload.sort !== undefined && { sort: payload.sort }),
          ...(payload.source !== undefined && { source: payload.source }),
          ...(payload.type !== undefined && { type: payload.type }),
          updatedAt: new Date(),
        } as Record<string, unknown>;

        if (Object.keys(updateFields).length === 1) {
          throw this.createBusinessError('未提供需要更新的字段');
        }

        const [updated] = await tx
          .update(aiModels)
          .set(updateFields)
          .where(and(...conditions))
          .returning();

        if (!updated) {
          throw this.createBusinessError('更新模型失败');
        }

        return updated;
      });
    } catch (error) {
      this.handleServiceError(error, '更新模型');
    }
  }
}
