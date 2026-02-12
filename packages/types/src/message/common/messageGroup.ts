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
  compressedAt?: string;
  compressedTokenCount?: number;
  // Compression info
  compressionStrategy?: 'summarize';

  endMessageId?: string;
  // UI state
  expanded?: boolean;
  originalMessageCount?: number;

  // Statistics
  originalTokenCount?: number;
  pinnedMessageIds?: string[];

  // Compression range
  startMessageId?: string;
}

/**
 * Message group item
 */
export interface MessageGroupItem {
  clientId?: string | null;
  content?: string | null;
  createdAt: Date;
  description?: string | null;
  editorData?: any | null;

  id: string;
  parentGroupId?: string | null;

  parentMessageId?: string | null;
  // Metadata
  title?: string | null;
  topicId?: string | null;

  // Compression fields
  type?: IMessageGroupType | null;
  updatedAt: Date;
  userId: string;
}
