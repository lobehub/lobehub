/**
 * Type Index
 *
 * Centralized exports for all conversation flow types.
 * Types are organized into three categories:
 *
 * 1. Context Tree (types/contextTree.ts) - Tree structure for navigation
 * 2. Flat Message List (types/flatMessageList.ts) - Optimized for rendering
 * 3. Shared (types/shared.ts) - Common types used across modules
 */

// Context Tree Types
export type {
  AgentCouncilNode,
  AssistantGroupNode,
  BranchNode,
  CompareGroupChild,
  CompareGroupNode,
  CompareNode,
  CompressedGroupNode,
  ContextNode,
  MessageNode,
  PinnedMessage,
  TasksNode,
} from './contextTree';

// Flat Message List Types
export type { FlatMessage, FlatMessageExtra, FlatMessageRole } from './flatMessageList';

// Shared Types
export type { HelperMaps, IdNode, Message, MessageGroupMetadata, ParseResult } from './shared';
