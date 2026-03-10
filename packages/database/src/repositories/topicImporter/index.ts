import type { ExportedTopic, ImportedMessage } from '@lobechat/types';

import { messagePlugins, messages, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';

export interface ImportTopicParams {
  agentId: string;
  /** JSON string or parsed object */
  data: ExportedTopic | ImportedMessage[] | string;
  groupId?: string | null;
}

export interface ImportTopicResult {
  messageCount: number;
  topicId: string;
}

interface PreparedMessage {
  agentId: string;
  content: string;
  createdAt: Date;
  error?: Record<string, any> | null;
  id: string;
  metadata?: Record<string, any> | null;
  model?: string | null;
  parentId: string | null;
  provider?: string | null;
  reasoning?: Record<string, any> | null;
  role: string;
  search?: Record<string, any> | null;
  tools?: Record<string, any>[] | null;
  topicId: string;
  traceId?: string | null;
  updatedAt: Date;
  userId: string;
}

interface PreparedMessagePlugin {
  apiName?: string | null;
  arguments?: string | null;
  error?: Record<string, any> | null;
  id: string;
  identifier?: string | null;
  state?: Record<string, any> | null;
  toolCallId?: string | null;
  type?: string | null;
  userId: string;
}

export class TopicImporterRepo {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Import messages as a new topic
   */
  importTopic = async (params: ImportTopicParams): Promise<ImportTopicResult> => {
    const { agentId, groupId, data } = params;

    // Parse data if it's a string
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;

    // Extract messages and title from parsed data
    const { messages: importedMessages, title } = this.parseImportData(parsedData);

    // Filter out system messages and prepare messages
    const filteredMessages = importedMessages.filter((m) => m.role !== 'system');

    if (filteredMessages.length === 0) {
      throw new Error('No valid messages to import');
    }

    return this.db.transaction(async (tx) => {
      // Generate new topic ID
      const topicId = idGenerator('topics');

      // Prepare messages with new IDs and rebuild parentId chain
      const { messages: preparedMessages, plugins: preparedPlugins } = this.prepareMessages(
        filteredMessages,
        topicId,
        agentId,
      );

      // Insert topic first
      await tx.insert(topics).values({
        agentId,
        groupId: groupId || null,
        id: topicId,
        title: title || 'Imported Topic',
        userId: this.userId,
      });

      // Batch insert messages
      if (preparedMessages.length > 0) {
        await tx.insert(messages).values(preparedMessages as any);
      }

      // Batch insert message plugins (for tool messages)
      if (preparedPlugins.length > 0) {
        await tx.insert(messagePlugins).values(preparedPlugins as any);
      }

      return {
        messageCount: preparedMessages.length,
        topicId,
      };
    });
  };

  /**
   * Parse import data to extract messages and title
   * Supports both simple array format and full ExportedTopic format
   */
  private parseImportData(data: unknown): { messages: ImportedMessage[]; title?: string } {
    // Format 1: Array (simple OpenAI compatible format)
    if (Array.isArray(data)) {
      return { messages: data as ImportedMessage[] };
    }

    // Format 2: ExportedTopic object (full lossless format)
    if (data && typeof data === 'object' && 'version' in data) {
      const fullData = data as ExportedTopic;
      return {
        messages: fullData.messages as ImportedMessage[],
        title: fullData.title,
      };
    }

    throw new Error('Invalid import format: expected array or ExportedTopic object');
  }

  /**
   * Prepare messages with new IDs and rebuild parentId chain
   */
  private prepareMessages(
    importedMessages: ImportedMessage[],
    topicId: string,
    agentId: string,
  ): { messages: PreparedMessage[]; plugins: PreparedMessagePlugin[] } {
    const now = Date.now();

    // Check if original data has any parentId info (before mapping)
    // This determines whether we should build a linear chain for missing parentIds
    const hasOriginalParentInfo = importedMessages.some(
      (m) => m.parentId !== undefined && m.parentId !== null,
    );

    // Build oldId -> newId mapping
    const idMapping = new Map<string, string>();

    // First pass: generate new IDs and create mapping
    const messagesWithNewIds = importedMessages.map((msg, index) => {
      const newId = idGenerator('messages');

      // If original message has an ID, create mapping
      if (msg.id) {
        idMapping.set(msg.id, newId);
      }

      return {
        ...msg,
        newId,
        originalParentId: msg.parentId,
        // Preserve original timestamp or generate sequential one
        timestamp: this.parseTimestamp(msg.createdAt, now + index),
        updatedTimestamp: this.parseTimestamp(msg.updatedAt, now + index),
      };
    });

    // Second pass: rebuild parentId chain and collect plugin data
    const preparedMessages: PreparedMessage[] = [];
    const preparedPlugins: PreparedMessagePlugin[] = [];

    for (const msg of messagesWithNewIds) {
      let parentId: string | null = null;

      // Try to restore original parentId relationship
      if (msg.originalParentId) {
        parentId = idMapping.get(msg.originalParentId) ?? null;
      }

      // Prepare message (without plugin fields - they go to separate table)
      preparedMessages.push({
        agentId,
        content: msg.content,
        createdAt: new Date(msg.timestamp),
        error: msg.error || null,
        id: msg.newId,
        metadata: msg.metadata || null,
        model: msg.model || null,
        parentId,
        provider: msg.provider || null,
        reasoning: msg.reasoning || null,
        role: msg.role,
        search: msg.search || null,
        tools: msg.tools || null,
        topicId,
        traceId: msg.traceId || null,
        updatedAt: new Date(msg.updatedTimestamp),
        userId: this.userId,
      });

      // If message has plugin data (tool messages), prepare plugin record
      if (msg.plugin || msg.pluginState || msg.pluginError || msg.tool_call_id) {
        const plugin = msg.plugin as Record<string, any> | undefined;
        preparedPlugins.push({
          apiName: plugin?.apiName || null,
          arguments: plugin?.arguments || null,
          error: msg.pluginError || null,
          id: msg.newId,
          identifier: plugin?.identifier || null,
          state: msg.pluginState || null,
          toolCallId: msg.tool_call_id || null,
          type: plugin?.type || null,
          userId: this.userId,
        });
      }
    }

    // If no parentId info exists in original data (simple format), build linear chain
    if (!hasOriginalParentInfo && preparedMessages.length > 1) {
      for (let i = 1; i < preparedMessages.length; i++) {
        preparedMessages[i].parentId = preparedMessages[i - 1].id;
      }
    }

    return { messages: preparedMessages, plugins: preparedPlugins };
  }

  /**
   * Parse timestamp from various formats
   */
  private parseTimestamp(value: number | string | undefined, fallback: number): number {
    if (value === undefined) {
      return fallback;
    }

    if (typeof value === 'number') {
      return value;
    }

    // Try to parse ISO string
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
}
