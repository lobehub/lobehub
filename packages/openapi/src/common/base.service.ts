import { and, eq, inArray } from 'drizzle-orm';

import type { PERMISSION_ACTIONS } from '@/const/rbac';
import { ALL_SCOPE } from '@/const/rbac';
import { RbacModel } from '@/database/models/rbac';
import {
  agents,
  aiModels,
  aiProviders,
  files,
  knowledgeBases,
  messages,
  sessions,
  topics,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getScopePermissions } from '@/utils/rbac';

import { getActionType, getResourceType } from '../helpers/permission';
import type { IBaseService, TBatchTarget, TTarget } from '../types';

const isNilOrEmptyObject = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value !== 'object') return false;
  return Object.keys(value as object).length === 0;
};

/**
 * Base service class
 * Provides unified service layer base functionality, consistent with the project's existing service layer pattern
 */
export abstract class BaseService implements IBaseService {
  protected userId: string;
  public db: LobeChatDatabase;
  private rbacModel: RbacModel;

  constructor(db: LobeChatDatabase, userId: string | null) {
    this.db = db;
    this.userId = userId || '';
    this.rbacModel = new RbacModel(db, this.userId);
  }

  /**
   * Business error class
   */
  protected createBusinessError(message: string): Error {
    const error = new Error(message);
    error.name = 'BusinessError';
    return error;
  }

  /**
   * Authentication error class
   */
  protected createAuthError(message: string): Error {
    const error = new Error(message);
    error.name = 'AuthenticationError';
    return error;
  }

  /**
   * Authorization error class
   */
  protected createAuthorizationError(message: string): Error {
    const error = new Error(message);
    error.name = 'AuthorizationError';
    return error;
  }

  /**
   * Not found error class
   */
  protected createNotFoundError(message: string): Error {
    const error = new Error(message);
    error.name = 'NotFoundError';
    return error;
  }

  /**
   * Validation error class
   */
  protected createValidationError(message: string): Error {
    const error = new Error(message);
    error.name = 'ValidationError';
    return error;
  }

  /**
   * Common error class (alias for business error)
   */
  protected createCommonError(message: string): Error {
    return this.createBusinessError(message);
  }

  /**
   * Unified error handling method
   * @param error Caught error
   * @param operation Operation name
   * @param fallbackMessage Default error message
   */
  protected handleServiceError(error: unknown, operation: string): never {
    this.log('error', `${operation}失败`, { error });

    // If it is a known business error, throw it directly
    if (
      error instanceof Error &&
      [
        'BusinessError',
        'AuthenticationError',
        'AuthorizationError',
        'NotFoundError',
        'ValidationError',
      ].includes(error.name)
    ) {
      throw error;
    }

    const errorMessage = `${operation}失败: ${error instanceof Error ? error.message : '未知错误'}`;

    // Wrap all other errors as business errors
    throw this.createBusinessError(errorMessage);
  }

  /**
   * Logging utility
   * @param level Log level
   * @param message Log message
   * @param data Additional data
   */
  protected log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any): void {
    const logMessage = `[${this.constructor.name}] ${message}`;

    switch (level) {
      case 'info': {
        console.info(logMessage, data || '');
        break;
      }
      case 'warn': {
        console.warn(logMessage, data || '');
        break;
      }
      case 'error': {
        console.error(logMessage, data || '');
        break;
      }
      case 'debug': {
        console.info(logMessage, data || ''); // debug → info
        break;
      }
    }
  }

  /**
   * Check whether the user has global ALL permission
   * @param permissionKey Permission key name
   * @returns Whether the user has the permission
   */
  protected async hasGlobalPermission(
    permissionKey: keyof typeof PERMISSION_ACTIONS,
  ): Promise<boolean> {
    return await this.rbacModel.hasAnyPermission(
      getScopePermissions(permissionKey, ['ALL']),
      this.userId,
    );
  }

  /**
   * Check whether the user has owner permission
   * @param permissionKey Permission key name
   * @returns Whether the user has the permission
   */
  protected async hasOwnerPermission(
    permissionKey: keyof typeof PERMISSION_ACTIONS,
  ): Promise<boolean> {
    return await this.rbacModel.hasAnyPermission(
      getScopePermissions(permissionKey, ['OWNER']),
      this.userId,
    );
  }

  /**
   * Get the user ID that a resource belongs to
   * @param target Target resource condition. If not provided, defaults to current user scope. If ALL is passed, returns full data query.
   * @returns The user ID the resource belongs to
   */
  protected async getResourceBelongTo(
    target?: TTarget | typeof ALL_SCOPE,
  ): Promise<string | undefined | null> {
    // Query all data, return undefined directly
    if (target === ALL_SCOPE) {
      return;
    }

    // If target condition is empty, default scope is current user
    if (!target || isNilOrEmptyObject(target)) {
      return this.userId;
    }

    try {
      switch (true) {
        // Query sessions table
        case !!target?.targetSessionId: {
          const targetSession = await this.db.query.sessions.findFirst({
            columns: { userId: true },
            where: eq(sessions.id, target.targetSessionId),
          });
          return targetSession?.userId;
        }

        // Query agents table
        case !!target?.targetAgentId: {
          const targetAgent = await this.db.query.agents.findFirst({
            columns: { userId: true },
            where: eq(agents.id, target.targetAgentId),
          });

          return targetAgent?.userId;
        }

        // Query topics table
        case !!target?.targetTopicId: {
          const targetTopic = await this.db.query.topics.findFirst({
            columns: { userId: true },
            where: eq(topics.id, target.targetTopicId),
          });
          return targetTopic?.userId;
        }

        // Query providers table
        case !!target?.targetProviderId: {
          const currentUserProvider = await this.db.query.aiProviders.findFirst({
            columns: { userId: true },
            where: and(
              eq(aiProviders.id, target.targetProviderId),
              eq(aiProviders.userId, this.userId),
            ),
          });

          if (currentUserProvider) {
            return currentUserProvider.userId;
          }

          const targetProvider = await this.db.query.aiProviders.findFirst({
            columns: { userId: true },
            where: eq(aiProviders.id, target.targetProviderId),
          });
          return targetProvider?.userId;
        }

        // Case where targetUserId is passed directly
        case !!target?.targetUserId: {
          return target.targetUserId;
        }

        // Query knowledgeBases table
        case !!target?.targetKnowledgeBaseId: {
          const targetKnowledgeBase = await this.db.query.knowledgeBases.findFirst({
            columns: { userId: true },
            where: eq(knowledgeBases.id, target.targetKnowledgeBaseId),
          });
          return targetKnowledgeBase?.userId;
        }

        // Query files table
        case !!target?.targetFileId: {
          const targetFile = await this.db.query.files.findFirst({
            columns: { userId: true },
            where: eq(files.id, target.targetFileId),
          });
          return targetFile?.userId;
        }

        // Query messages table
        case !!target?.targetMessageId: {
          const targetMessage = await this.db.query.messages.findFirst({
            columns: { userId: true },
            where: eq(messages.id, target.targetMessageId),
          });
          return targetMessage?.userId;
        }

        // Query aiModels table
        case !!target?.targetModelId: {
          const targetModel = await this.db.query.aiModels.findFirst({
            columns: { userId: true },
            where: eq(aiModels.id, target.targetModelId),
          });
          return targetModel?.userId;
        }

        default: {
          return;
        }
      }
    } catch (error) {
      this.log('error', '获取目标用户ID失败', { error, target });
      return;
    }
  }

  /**
   * Resolve permissions and return target info
   * Common logic for handling data access permissions, supporting the following scenarios:
   * 1. Query/operate on current user's data: requires ALL/owner permission
   * 2. Query/operate on a specific user's data: requires ALL permission
   * 3. Query/operate on all data: requires ALL permission
   *
   * @param permissionKey - Permission key name
   * @param targetInfoId - Target ID, optional. A string means query/operate on a specific user's data; an object key-value means query/operate on a specific object's data
   * @param queryAll - Whether to query all data, optional. If provided, queries all data; otherwise only queries current user's data
   * @returns Returns permission check result and query/operation condition
   *          - isPermitted: Whether query/operation is permitted
   *          - condition: Target info containing userId filter
   *          - message: Error message when permission is denied
   */
  protected async resolveOperationPermission(
    permissionKey: keyof typeof PERMISSION_ACTIONS,
    resourceInfo?: TTarget | typeof ALL_SCOPE,
  ): Promise<{
    condition?: { userId?: string };
    isPermitted: boolean;
    message?: string;
  }> {
    // Check if the user has ALL permission for the corresponding action
    const hasGlobalAccess = await this.hasGlobalPermission(permissionKey);

    // Get the user ID that the target resource belongs to
    const resourceBelongTo = await this.getResourceBelongTo(resourceInfo);

    // Log the resource the user wants to access and current user info
    const logContext = {
      resourceInfo,
      userId: this.userId,
    };

    this.log('info', '权限检查', logContext);

    /**
     * When the user has ALL permission, pass the check directly
     */
    if (hasGlobalAccess) {
      this.log('info', `权限通过：当前user拥有 ${permissionKey} 的最高权限`, logContext);
      return {
        condition: resourceBelongTo ? { userId: resourceBelongTo } : undefined,
        isPermitted: true,
      };
    }

    /**
     * When the user does not have ALL permission, the following scenarios are not allowed:
     * 1. Querying all data
     * 2. Querying a specific user's data, but the target resource does not belong to the current user
     */
    if (!resourceBelongTo || resourceBelongTo !== this.userId) {
      this.log('warn', '权限拒绝：当前user没有ALL权限，或目标资源不属于当前用户', logContext);
      return {
        isPermitted: false,
        message: `no permission,current user has no ALL permission,and resource not belong to current user`,
      };
    }

    /**
     * When the target resource belongs to the current user, any permission allows the operation
     * Since ALL permission was already checked above, only owner permission needs to be checked here
     */
    if (resourceBelongTo === this.userId) {
      // Check if the user has owner permission for the corresponding action
      const hasOwnerAccess = await this.hasOwnerPermission(permissionKey);

      if (hasOwnerAccess) {
        this.log('info', '权限通过：当前user拥有owner权限', logContext);
        return {
          condition: { userId: resourceBelongTo },
          isPermitted: true,
        };
      }

      this.log('warn', '权限拒绝：目标资源属于当前用户，但用户没有对应操作的owner权限', logContext);
      return {
        isPermitted: false,
        message: `no permission,resource belong to current user,but current user has no any ${permissionKey} permission`,
      };
    }

    // If we reach here, apply fallback logic
    this.log('info', `兜底: no permission`, logContext);
    return {
      isPermitted: false,
      message: `permission validation error for: ${permissionKey}`,
    };
  }

  /**
   * Resolve permissions for batch operations
   * Common logic for handling batch data access permissions
   * 1. Batch operations require ALL permission
   * 2. If all resources belong to the current user and the user has owner permission, the operation is also allowed
   * 3. If the user has ALL permission, all specified resources can be operated on
   *
   * @param permissionKey - Permission key name
   * @param targetInfoIds - Array of target resource IDs
   * @returns Returns the permission check result
   */
  protected async resolveBatchQueryPermission(
    permissionKey: keyof typeof PERMISSION_ACTIONS,
    targetInfoIds: TBatchTarget,
  ): Promise<{
    condition?: { userIds?: string[] };
    isPermitted: boolean;
    message?: string;
  }> {
    // First check if the user has global permission; if so, pass directly
    const hasGlobalAccess = await this.hasGlobalPermission(permissionKey);

    // If the user has global permission, allow the batch operation directly
    if (hasGlobalAccess) {
      this.log('info', `权限通过：批量操作，当前user拥有 ${permissionKey} ALL权限`);
      return { isPermitted: true };
    }

    // Get the user IDs for all resources
    let userIds: string[];
    try {
      // Automatically determine the resource type based on properties in targetInfoIds
      switch (true) {
        case !!targetInfoIds.targetSessionIds?.length: {
          const sessionList = await this.db.query.sessions.findMany({
            where: inArray(sessions.id, targetInfoIds.targetSessionIds),
          });
          userIds = sessionList.map((s) => s.userId);
          break;
        }
        case !!targetInfoIds.targetAgentIds?.length: {
          const agentList = await this.db.query.agents.findMany({
            where: inArray(agents.id, targetInfoIds.targetAgentIds),
          });
          userIds = agentList.filter((a) => !!a.userId).map((a) => a.userId as string);
          break;
        }
        case !!targetInfoIds.targetTopicIds?.length: {
          const topicList = await this.db.query.topics.findMany({
            where: inArray(topics.id, targetInfoIds.targetTopicIds),
          });
          userIds = topicList.map((t) => t.userId);
          break;
        }
        case !!targetInfoIds.targetProviderIds?.length: {
          const providerIds = targetInfoIds.targetProviderIds;
          const ownedProviders = await this.db.query.aiProviders.findMany({
            where: and(inArray(aiProviders.id, providerIds), eq(aiProviders.userId, this.userId)),
          });

          // First try to match the current user by composite key (id, userId) to avoid false positives when multiple users share the same provider id
          if (ownedProviders.length === providerIds.length) {
            userIds = ownedProviders.map(() => this.userId);
            break;
          }

          const providerList = await this.db.query.aiProviders.findMany({
            where: inArray(aiProviders.id, providerIds),
          });
          userIds = providerList.map((p) => p.userId);
          break;
        }
        case !!targetInfoIds.targetUserIds?.length: {
          userIds = targetInfoIds.targetUserIds;
          break;
        }
        case !!targetInfoIds.targetKnowledgeBaseIds?.length: {
          const knowledgeBaseList = await this.db.query.knowledgeBases.findMany({
            where: inArray(knowledgeBases.id, targetInfoIds.targetKnowledgeBaseIds),
          });
          userIds = knowledgeBaseList.map((kb) => kb.userId);
          break;
        }
        case !!targetInfoIds.targetFileIds?.length: {
          const fileList = await this.db.query.files.findMany({
            where: inArray(files.id, targetInfoIds.targetFileIds),
          });
          userIds = fileList.map((f) => f.userId);
          break;
        }
        case !!targetInfoIds.targetMessageIds?.length: {
          const messageList = await this.db.query.messages.findMany({
            where: inArray(messages.id, targetInfoIds.targetMessageIds),
          });
          userIds = messageList.map((m) => m.userId);
          break;
        }
        case !!targetInfoIds.targetModelIds?.length: {
          const modelList = await this.db.query.aiModels.findMany({
            where: inArray(aiModels.id, targetInfoIds.targetModelIds),
          });
          userIds = modelList.map((m) => m.userId);
          break;
        }
        default: {
          return {
            isPermitted: false,
            message: '未提供有效的资源 ID',
          };
        }
      }
    } catch (error) {
      this.log('error', '获取目标用户ID失败', { error, targetInfoIds });
      return {
        isPermitted: false,
        message: '获取资源信息失败',
      };
    }

    // If no resources are found
    if (userIds.length === 0) {
      this.log('warn', '未找到任何目标资源', { permissionKey, targetInfoIds });
      return {
        condition: { userIds },
        isPermitted: false,
        message: '未找到任何目标资源',
      };
    }

    // Check if all resources belong to the current user
    const allBelongToCurrentUser = userIds.every((id) => id === this.userId);
    if (allBelongToCurrentUser) {
      // Check if the user has owner permission
      const hasOwnerAccess = await this.hasOwnerPermission(permissionKey);

      if (hasOwnerAccess) {
        this.log(
          'info',
          `权限通过：批量操作，所有资源属于当前用户，且拥有 ${permissionKey} owner 权限`,
        );
        return { condition: { userIds }, isPermitted: true };
      }

      // If all resources belong to the current user but the user has no owner permission, deny the operation
      this.log('warn', '权限拒绝：批量操作需要 ${permissionKey} ALL/owner 权限', {
        permissionKey,
        targetInfoIds,
        userIds,
      });
      return {
        isPermitted: false,
        message: `no permission for batch operation, current user has no ${permissionKey} ALL/owner permission`,
      };
    }

    // Some resources in the operation do not belong to the current user; deny directly
    this.log('warn', `权限拒绝：批量操作需要 ${permissionKey} ALL/owner 权限`, {
      permissionKey,
      targetInfoIds,
      userIds,
    });

    return {
      isPermitted: false,
      message: `no permission for batch operation, current user has no ${permissionKey} ALL/owner permission`,
    };
  }

  /**
   * Check if the user has all required chat-related permissions
   * Including:
   * - Message read/write permissions (MESSAGE_READ, MESSAGE_WRITE)
   * - Topic read/write permissions (TOPIC_READ, TOPIC_WRITE)
   * - Session read/write permissions (SESSION_READ, SESSION_WRITE)
   * - AI model read permission (AI_MODEL_READ)
   * - Agent read permission (AGENT_READ)
   * - File read permission (FILE_READ)
   *
   * @returns Returns the permission check result and list of missing permissions
   */
  protected async resolveChatPermissions(): Promise<{
    isPermitted: boolean;
    message?: string;
    missingPermissions: string[];
  }> {
    const requiredPermissions = [
      'MESSAGE_READ',
      'MESSAGE_CREATE',
      'TOPIC_READ',
      'TOPIC_CREATE',
      'SESSION_READ',
      'SESSION_CREATE',
      'AI_MODEL_READ',
      'AGENT_READ',
      'FILE_READ',
    ] as const;

    const permissionResults = await Promise.all(
      requiredPermissions.map(async (permission) => {
        const result = await this.resolveOperationPermission(permission);
        return {
          isPermitted: result.isPermitted,
          permission,
        };
      }),
    );

    const missingPermissions = permissionResults
      .filter((result) => !result.isPermitted)
      .map((result) => {
        const resourceType = getResourceType(result.permission);
        const actionType = getActionType(result.permission);
        return `${resourceType} ${actionType}`;
      });

    const isPermitted = missingPermissions.length === 0;

    this.log('info', '聊天权限检查', {
      isPermitted,
      missingPermissions,
      userId: this.userId,
    });

    if (!isPermitted) {
      return {
        isPermitted: false,
        message: `缺少必要权限：${missingPermissions.join(', ')}`,
        missingPermissions,
      };
    }

    return {
      isPermitted: true,
      missingPermissions: [],
    };
  }
}
