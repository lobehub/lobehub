import type { UIChatMessage } from '@lobechat/types';

/**
 * Flat Message List Types
 *
 * Flattened array optimized for virtual list rendering.
 * Contains virtual messages with extended role types for grouped display.
 */

/**
 * Extended message role types for flat list rendering
 *
 * Standard roles from UIChatMessage:
 * - 'user': User message
 * - 'assistant': Assistant message (standalone, without tools)
 * - 'tool': Tool execution result
 * - 'system': System message
 * - 'supervisor': Supervisor message in multi-agent
 *
 * Virtual roles created by parse():
 * - 'assistantGroup': Assistant message + tool calls aggregation
 * - 'messageGroup': Generic message group (manual/summary)
 * - 'compare': Compare mode for parallel model outputs
 * - 'agentCouncil': Multi-agent parallel responses (all enter context)
 * - 'tasks': Aggregated async task messages with same parentId
 *
 * Database-provided roles from MessageModel.query with MessageGroup aggregation:
 * - 'compressedGroup': Compressed/summarized messages with optional pinned messages
 * - 'compareGroup': Parallel model responses (from database, not metadata-driven)
 */
export type FlatMessageRole =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'system'
  | 'supervisor'
  | 'assistantGroup'
  | 'messageGroup'
  | 'compare'
  | 'agentCouncil'
  | 'tasks'
  | 'compressedGroup'
  | 'compareGroup';

/**
 * Message in flat list
 *
 * Can be either:
 * 1. Original message from database
 * 2. Virtual message created by parse() with extended role and children
 */
export type FlatMessage = UIChatMessage;

/**
 * Virtual message extra fields for flat list
 */
export interface FlatMessageExtra {
  /** Optional description for groups */
  description?: string;
  /** Group mode for messageGroup and compare virtual messages */
  groupMode?: 'compare' | 'manual' | 'summary';
  /** Parent message ID that triggered this group */
  parentMessageId?: string;
}
