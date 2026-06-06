import { and, asc, count, eq, ilike, or } from 'drizzle-orm';

import { aiModels } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import type { ServiceResult } from '../types';
import type {
  CreateModelRequest,
  GetModelsResponse,
  ModelDetailResponse,
  ModelsListQuery,
  UpdateModelRequest,
} from '../types/model.type';

/**
 * Model service implementation class (dedicated to Hono API)
 * Provides model query and grouping functionality
 */
export class ModelService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
  }

  /**
   * Get model list
   * @param request Query request parameters
   */
  async getModels(request: ModelsListQuery = {}): ServiceResult<GetModelsResponse> {
    this.log('info', 'Getting model list', {
      ...request,
      userId: this.userId,
    });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('AI_MODEL_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'Unauthorized to access model list');
      }

      // Build query conditions
      const conditions = [];

      // Add permission condition directly to the main conditions array
      if (permissionResult.condition?.userId) {
        conditions.push(eq(aiModels.userId, permissionResult.condition.userId));
      }

      // Handle ModelsListQuery-specific parameters
      const { page, pageSize, keyword, provider, type, enabled } = request;

      // If a keyword is provided, add it to the query conditions
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

      // Calculate offset
      const { limit, offset } = processPaginationConditions({ page, pageSize });

      // Execute query and count in parallel
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
      this.handleServiceError(error, 'get model list');
    }
  }

  /**
   * Get model details
   */
  async getModelDetail(providerId: string, modelId: string): ServiceResult<ModelDetailResponse> {
    this.log('info', 'Getting model detail', { modelId, providerId, userId: this.userId });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_MODEL_READ', {
        targetModelId: modelId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'Unauthorized to access model detail');
      }

      const conditions = [eq(aiModels.providerId, providerId), eq(aiModels.id, modelId)];

      if (permissionResult.condition?.userId) {
        conditions.push(eq(aiModels.userId, permissionResult.condition.userId));
      }

      const model = await this.db.query.aiModels.findFirst({ where: and(...conditions) });

      if (!model) {
        throw this.createNotFoundError(`Model ${providerId}/${modelId} does not exist`);
      }

      return model;
    } catch (error) {
      this.handleServiceError(error, 'get model detail');
    }
  }

  /**
   * Create a model
   */
  async createModel(payload: CreateModelRequest): ServiceResult<ModelDetailResponse> {
    this.log('info', 'Creating model', { payload, userId: this.userId });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_MODEL_CREATE');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'Unauthorized to create model');
      }

      if (!this.userId) {
        throw this.createAuthError('User not authenticated');
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
          throw this.createBusinessError(`Model ${payload.providerId}/${payload.id} already exists`);
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
      this.handleServiceError(error, 'create model');
    }
  }

  /**
   * Update a model
   */
  async updateModel(
    providerId: string,
    modelId: string,
    payload: UpdateModelRequest,
  ): ServiceResult<ModelDetailResponse> {
    this.log('info', 'Updating model', { modelId, payload, providerId, userId: this.userId });

    try {
      const permissionResult = await this.resolveOperationPermission('AI_MODEL_UPDATE', {
        targetModelId: modelId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'Unauthorized to update model');
      }

      const conditions = [eq(aiModels.providerId, providerId), eq(aiModels.id, modelId)];
      if (permissionResult.condition?.userId) {
        conditions.push(eq(aiModels.userId, permissionResult.condition.userId));
      }

      return await this.db.transaction(async (tx) => {
        const existingModel = await tx.query.aiModels.findFirst({ where: and(...conditions) });

        if (!existingModel) {
          throw this.createNotFoundError(`Model ${providerId}/${modelId} does not exist`);
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
          throw this.createBusinessError('No fields provided for update');
        }

        const [updated] = await tx
          .update(aiModels)
          .set(updateFields)
          .where(and(...conditions))
          .returning();

        if (!updated) {
          throw this.createBusinessError('Failed to update model');
        }

        return updated;
      });
    } catch (error) {
      this.handleServiceError(error, 'update model');
    }
  }
}
