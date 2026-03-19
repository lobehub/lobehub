// Import zod for common schemas
import type { LobeChatDatabase } from '@/database/type';

/**
 * Standard API response format
 */
export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
  success: boolean;
  timestamp: string;
}

/**
 * Service interface base class
 */
export interface IBaseService {
  /**
   * Database instance
   */
  db?: LobeChatDatabase;
}

/**
 * Service method return type
 */
export type ServiceResult<T = any> = Promise<T>;

export interface TTarget {
  targetAgentId?: string;
  targetFileId?: string;
  targetKnowledgeBaseId?: string;
  targetMessageId?: string;
  targetModelId?: string;
  targetProviderId?: string;
  targetRoleId?: string;
  targetSessionId?: string;
  targetTopicId?: string;
  targetUserId?: string;
}

export interface TBatchTarget {
  targetAgentIds?: string[];
  targetFileIds?: string[];
  targetKnowledgeBaseIds?: string[];
  targetMessageIds?: string[];
  targetModelIds?: string[];
  targetProviderIds?: string[];
  targetRoleIds?: string[];
  targetSessionIds?: string[];
  targetTopicIds?: string[];
  targetUserIds?: string[];
}

// ==================== Export All Types ====================
export * from './agent.type';
export * from './agent-group.type';
export * from './chat.type';
export * from './common.type';
export * from './file.type';
export * from './knowledge-base.type';
export * from './message.type';
export * from './message-translations.type';
export * from './model.type';
export * from './permission.type';
export * from './provider.type';
export * from './responses.type';
export * from './role.type';
export * from './topic.type';
export * from './user.type';
