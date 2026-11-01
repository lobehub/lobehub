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
 * Which threaded messages belong to the rendered flat list.
 *
 * - `undefined`: every message is in scope. Used when the input holds only threaded rows (a
 *   thread passed on its own), where there is no main flow to separate.
 * - `null`: the main flow only. Threaded rows are side conversations (background runs,
 *   sub-agent turns) and must not be walked into the transcript.
 * - a thread id: the main flow plus that thread. This is the thread view, whose query
 *   intentionally returns the unthreaded ancestors together with the thread's replies.
 */
export type ThreadScope = string | null | undefined;

export interface ParseOptions {
  /**
   * The thread the caller is rendering, or `null` for the main flow. Omit it to derive the
   * scope from the input: mixed input is treated as the main flow, thread-only input as the
   * thread itself. Thread views must pass it, because their input mixes ancestors and replies.
   */
  threadId?: string | null;
}

/**
 * Internal helper maps used during parsing
 */
export interface HelperMaps {
  /** Maps parent ID to array of child IDs */
  childrenMap: Map<string | null, string[]>;
  /** Maps message group ID to its metadata */
  messageGroupMap: Map<string, MessageGroupMetadata>;
  /** Maps message ID to message */
  messageMap: Map<string, Message>;
  /** Maps thread ID to all messages in that thread */
  threadMap: Map<string, Message[]>;
  /** Which threaded messages the flat list may walk. See `ThreadScope`. */
  threadScope: ThreadScope;
}
