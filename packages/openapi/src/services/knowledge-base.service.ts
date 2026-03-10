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
 * 知识库服务类
 * 处理知识库的增删改查功能
 */
export class KnowledgeBaseService extends BaseService {
  private knowledgeBaseModel: KnowledgeBaseModel;

  constructor(db: LobeChatDatabase, userId: string) {
    super(db, userId);
    this.knowledgeBaseModel = new KnowledgeBaseModel(db, userId);
  }

  /**
   * 获取知识库列表
   */
  async getKnowledgeBaseList(request: KnowledgeBaseListQuery): Promise<KnowledgeBaseListResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问知识库列表');
      }

      this.log('info', 'Getting knowledge base list', request);

      // 计算分页参数与查询条件
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

      // 添加访问类型
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
   * 获取知识库详情
   */
  async getKnowledgeBaseDetail(id: string): Promise<KnowledgeBaseDetailResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此知识库');
      }

      this.log('info', 'Getting knowledge base detail', { id });

      // 使用模型的 findById 方法，它包含了访问权限和启用状态的检查
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
   * 创建知识库
   */
  async createKnowledgeBase(
    request: CreateKnowledgeBaseRequest,
  ): Promise<CreateKnowledgeBaseResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_CREATE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权创建知识库');
      }

      this.log('info', 'Creating knowledge base', {
        name: request.name,
      });

      // 创建知识库
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
   * 更新知识库
   */
  async updateKnowledgeBase(
    id: string,
    request: UpdateKnowledgeBaseRequest,
  ): Promise<KnowledgeBaseDetailResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_UPDATE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权更新此知识库');
      }

      this.log('info', 'Updating knowledge base', { id, request });

      // 检查知识库是否存在且属于当前用户
      const existingKb = await this.db.query.knowledgeBases.findFirst({
        where: and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)),
      });

      if (!existingKb) {
        throw this.createNotFoundError('Knowledge base not found or access denied');
      }

      // 更新知识库
      await this.knowledgeBaseModel.update(id, request);

      // 获取更新后的知识库信息
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
   * 删除知识库
   */
  async deleteKnowledgeBase(id: string): Promise<DeleteKnowledgeBaseResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_DELETE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权删除此知识库');
      }

      this.log('info', 'Deleting knowledge base', { id });

      // 检查知识库是否存在且属于当前用户
      const existingKb = await this.db.query.knowledgeBases.findFirst({
        where: and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)),
      });

      if (!existingKb) {
        throw this.createNotFoundError('Knowledge base not found or access denied');
      }

      // 删除知识库
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
