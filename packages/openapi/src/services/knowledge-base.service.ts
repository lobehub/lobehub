import { and, count, desc, eq, ilike, or } from 'drizzle-orm';

import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import type { KnowledgeBaseItem } from '@/database/schemas';
import { knowledgeBases } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import type {
  CreateKnowledgeBaseRequest,
  CreateKnowledgeBaseResponse,
  DeleteKnowledgeBaseResponse,
  KnowledgeBaseAccessType,
  KnowledgeBaseDetailResponse,
  KnowledgeBaseListItem,
  KnowledgeBaseListQuery,
  KnowledgeBaseListResponse,
  UpdateKnowledgeBaseRequest,
} from '../types/knowledge-base.type';

/**
 * Knowledge base service class
 * Handles CRUD operations for knowledge bases
 */
export class KnowledgeBaseService extends BaseService {
  private knowledgeBaseModel: KnowledgeBaseModel;

  constructor(db: LobeChatDatabase, userId: string) {
    super(db, userId);
    this.knowledgeBaseModel = new KnowledgeBaseModel(db, userId);
  }

  /**
   * Get knowledge base list
   */
  async getKnowledgeBaseList(request: KnowledgeBaseListQuery): Promise<KnowledgeBaseListResponse> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问知识库列表');
      }

      this.log('info', 'Getting knowledge base list', request);

      // Calculate pagination parameters and query conditions
      const { limit, offset } = processPaginationConditions(request);
      const { keyword } = request;

      const conditions = [eq(knowledgeBases.userId, this.userId)];

      if (keyword) {
        conditions.push(
          or(
            ilike(knowledgeBases.name, `%${keyword}%`),
            ilike(knowledgeBases.description, `%${keyword}%`),
          )!,
        );
      }

      const whereCondition = and(...conditions);

      const [items, totalResult] = await Promise.all([
        this.db.query.knowledgeBases.findMany({
          limit,
          offset,
          orderBy: [desc(knowledgeBases.updatedAt)],
          where: whereCondition,
        }),
        this.db.select({ count: count() }).from(knowledgeBases).where(whereCondition),
      ]);

      const total = totalResult[0]?.count || 0;

      // Add access type
      const knowledgeBasesWithAuthorization = items.map((item) => {
        const accessType: KnowledgeBaseAccessType = 'owner';

        return {
          ...item,
          accessType,
        } as KnowledgeBaseListItem;
      });

      this.log('info', 'Knowledge base list retrieved successfully', {
        count: knowledgeBasesWithAuthorization.length,
        total,
      });

      return {
        knowledgeBases: knowledgeBasesWithAuthorization,
        total,
      };
    } catch (error) {
      this.handleServiceError(error, '获取知识库列表');
    }
  }

  /**
   * Get knowledge base detail
   */
  async getKnowledgeBaseDetail(id: string): Promise<KnowledgeBaseDetailResponse> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此知识库');
      }

      this.log('info', 'Getting knowledge base detail', { id });

      // Use the model's findById method, which includes access permission and enabled status checks
      const knowledgeBase = await this.knowledgeBaseModel.findById(id);

      if (!knowledgeBase) {
        throw this.createNotFoundError('Knowledge base not found or access denied');
      }

      this.log('info', 'Knowledge base detail retrieved successfully', { id });

      return {
        knowledgeBase,
      };
    } catch (error) {
      this.handleServiceError(error, '获取知识库详情');
    }
  }

  /**
   * Create knowledge base
   */
  async createKnowledgeBase(
    request: CreateKnowledgeBaseRequest,
  ): Promise<CreateKnowledgeBaseResponse> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_CREATE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权创建知识库');
      }

      this.log('info', 'Creating knowledge base', {
        name: request.name,
      });

      // Create knowledge base
      const createData: Parameters<KnowledgeBaseModel['create']>[0] = {
        name: request.name,
      };

      if (request.avatar) createData.avatar = request.avatar;
      if (request.description) createData.description = request.description;

      const knowledgeBase = await this.knowledgeBaseModel.create(createData);

      this.log('info', 'Knowledge base created successfully', {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
      });

      return {
        knowledgeBase,
      };
    } catch (error) {
      this.handleServiceError(error, '创建知识库');
    }
  }

  /**
   * Update knowledge base
   */
  async updateKnowledgeBase(
    id: string,
    request: UpdateKnowledgeBaseRequest,
  ): Promise<KnowledgeBaseDetailResponse> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_UPDATE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权更新此知识库');
      }

      this.log('info', 'Updating knowledge base', { id, request });

      // Check if knowledge base exists and belongs to the current user
      const existingKb = await this.db.query.knowledgeBases.findFirst({
        where: and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)),
      });

      if (!existingKb) {
        throw this.createNotFoundError('Knowledge base not found or access denied');
      }

      // Update knowledge base
      await this.knowledgeBaseModel.update(id, request);

      // Get updated knowledge base info
      const updatedKb = await this.db.query.knowledgeBases.findFirst({
        where: eq(knowledgeBases.id, id),
      });

      this.log('info', 'Knowledge base updated successfully', { id });

      return {
        knowledgeBase: updatedKb as KnowledgeBaseItem,
      };
    } catch (error) {
      this.handleServiceError(error, '更新知识库');
    }
  }

  /**
   * Delete knowledge base
   */
  async deleteKnowledgeBase(id: string): Promise<DeleteKnowledgeBaseResponse> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_DELETE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权删除此知识库');
      }

      this.log('info', 'Deleting knowledge base', { id });

      // Check if knowledge base exists and belongs to the current user
      const existingKb = await this.db.query.knowledgeBases.findFirst({
        where: and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)),
      });

      if (!existingKb) {
        throw this.createNotFoundError('Knowledge base not found or access denied');
      }

      // Delete knowledge base
      await this.knowledgeBaseModel.delete(id);

      this.log('info', 'Knowledge base deleted successfully', { id });

      return {
        message: 'Knowledge base deleted successfully',
        success: true,
      };
    } catch (error) {
      this.handleServiceError(error, '删除知识库');
    }
  }
}
