import type { UIChatMessage } from '@lobechat/types';

import type { ContextNode } from './contextTree';
import type { FlatMessage } from './flatMessageList';

/**
 * Shared Types
 *
 * Common types used across the conversation flow engine.
 */

/**
 * Re-export UIChatMessage as Message for convenience
 */
export type Message = UIChatMessage;

/**
 * Message group metadata from database
 * Used for multi-model parallel conversations and manual grouping
 */
export interface MessageGroupMetadata {
  description?: string;
  id: string;
  /** Presentation mode: compare, summary, or manual */
  mode?: 'compare' | 'summary' | 'manual';
  /** Parent message that triggered this group */
  parentMessageId?: string;
  title?: string;
}

/**
 * Internal structure node used during tree building
 */
export interface IdNode {
  children: IdNode[];
  id: string;
}

/**
 * Result of the parse function
 */
export interface ParseResult {
  /** Semantic tree structure for navigation and context understanding */
  contextTree: ContextNode[];
  /** Flattened list optimized for virtual list rendering */
  flatList: FlatMessage[];
  /** Map for O(1) message access */
  messageMap: Record<string, Message>;
}

/**
 * Internal helper maps used during parsing
 */
export interface HelperMaps {
  /** Maps parent ID to array of child IDs */
  childrenMap: Map<string | null, string[]>;
  /**
   * True when the input mixes main-flow and threaded messages, so the threaded ones are a
   * side conversation to be left out of the transcript. False when a thread's messages are
   * all the caller passed (the thread view) — there is no main flow to separate, and every
   * message stays in scope.
   */
  mainFlowOnly: boolean;
  /** Maps message group ID to its metadata */
  messageGroupMap: Map<string, MessageGroupMetadata>;
  /** Maps message ID to message */
  messageMap: Map<string, Message>;
  /** Maps thread ID to all messages in that thread */
  threadMap: Map<string, Message[]>;
}
