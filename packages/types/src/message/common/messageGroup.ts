/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */

/**
 * Message group type
 * - parallel: multi-model parallel conversations
 * - compression: compressed message group
 */
export const MessageGroupType = {
  Parallel: 'parallel',
  Compression: 'compression',
} as const;

export type IMessageGroupType = (typeof MessageGroupType)[keyof typeof MessageGroupType];

/**
 * Metadata for compression type message groups
 */
export interface CompressionGroupMetadata {
  // Compression range
  startMessageId?: string;
  endMessageId?: string;
  pinnedMessageIds?: string[];

  // Statistics
  originalTokenCount?: number;
  compressedTokenCount?: number;
  originalMessageCount?: number;

  // Compression info
  compressionStrategy?: 'summarize';
  compressedAt?: string;
  modelId?: string;
}

/**
 * Message group item
 */
export interface MessageGroupItem {
  id: string;
  userId: string;
  topicId?: string | null;
  parentGroupId?: string | null;
  parentMessageId?: string | null;

  // Metadata
  title?: string | null;
  description?: string | null;

  // Compression fields
  type?: IMessageGroupType | null;
  content?: string | null;
  editorData?: any | null;

  clientId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
