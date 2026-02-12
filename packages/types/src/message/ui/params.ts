/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
import { z } from 'zod';

import type { ConversationContext } from '../../conversation';
import type { UploadFileItem } from '../../files';
import type { MessageSemanticSearchChunk } from '../../rag';
import type { ChatMessageError } from '../common/base';
import { ChatMessageErrorSchema } from '../common/base';
// Import for local use
import type { PageSelection } from '../common/pageSelection';
import type { ChatPluginPayload } from '../common/tools';
import { ToolInterventionSchema } from '../common/tools';
import type { UIChatMessage } from './chat';
import { SemanticSearchChunkSchema } from './rag';

export type CreateMessageRoleType = 'user' | 'assistant' | 'tool' | 'task' | 'supervisor';

export interface CreateMessageParams extends Partial<
  Omit<UIChatMessage, 'content' | 'role' | 'topicId' | 'chunksList'>
> {
  agentId?: string;
  content: string;
  error?: ChatMessageError | null;
  fileChunks?: MessageSemanticSearchChunk[];
  files?: string[];
  groupId?: string;
  model?: string;
  provider?: string;
  role: CreateMessageRoleType;
  /**
   * @deprecated Use agentId instead
   */
  sessionId?: string;
  targetId?: string | null;
  threadId?: string | null;
  topicId?: string;
  traceId?: string;
}

/**
 * Parameters for creating a new message with full message list return
 * This type is completely independent from UIChatMessage to ensure clean API contract
 */
export interface CreateNewMessageParams {
  agentId: string;
  content: string;
  // ========== Error handling ==========
  error?: ChatMessageError | null;

  fileChunks?: MessageSemanticSearchChunk[];
  // ========== Content ==========
  files?: string[];

  groupId?: string;
  // ========== Model info ==========
  model?: string;

  // ========== Grouping ==========
  parentId?: string;
  plugin?: ChatPluginPayload;
  provider?: string;

  // ========== Required fields ==========
  role: CreateMessageRoleType;
  targetId?: string | null;

  threadId?: string;

  // ========== Tool related ==========
  tool_call_id?: string;

  // ========== Context ==========
  topicId?: string;
  // ========== Metadata ==========
  traceId?: string;
}

export interface ChatContextContent {
  content: string;
  /**
   * Format of the content. Defaults to text.
   */
  format?: 'xml' | 'text' | 'markdown';
  id: string;
  /**
   * Page ID the selection belongs to (for page editor selections)
   */
  pageId?: string;
  /**
   * Optional short preview for displaying in UI.
   */
  preview?: string;
  title?: string;
  type: 'text';
}

// Re-export PageSelection from common for backwards compatibility
export type { PageSelection } from '../common/pageSelection';
export { PageSelectionSchema } from '../common/pageSelection';

export interface SendMessageParams {
  /**
   * Additional contextual snippets (e.g., text selections) attached to the request.
   * @deprecated Use pageSelections instead for page editor selections
   */
  contexts?: ChatContextContent[];
  /**
   * create a thread
   * @deprecated Use ConversationContext.newThread instead
   */
  createThread?: boolean;
  files?: UploadFileItem[];
  /**
   *
   * https://github.com/lobehub/lobe-chat/pull/2086
   */
  isWelcomeQuestion?: boolean;
  message: string;
  /**
   * Display messages for the current conversation context.
   * If provided, sendMessage will use these messages instead of querying from store.
   * This decouples sendMessage from store selectors.
   */
  messages?: UIChatMessage[];

  /**
   * Additional metadata for the message (e.g., mentioned users)
   */
  metadata?: Record<string, any>;

  onlyAddUserMessage?: boolean;
  /**
   * Page selections attached to the message (for Ask AI functionality)
   * These will be persisted to the database and injected via context-engine
   */
  pageSelections?: PageSelection[];
  /**
   * Parent message ID for the new message.
   * If not provided, will be calculated from messages list.
   */
  parentId?: string;
}

export interface SendGroupMessageParams {
  context: ConversationContext;
  files?: UploadFileItem[];
  message: string;
  /**
   * Additional metadata for the message (e.g., mentioned users)
   */
  metadata?: Record<string, any>;
  /**
   * for group chat
   */
  targetMemberId?: string | null;
}

// ========== Zod Schemas ========== //

const UIMessageRoleTypeSchema = z.enum(['user', 'assistant', 'tool', 'task', 'supervisor']);

const ChatPluginPayloadSchema = z.object({
  apiName: z.string(),
  arguments: z.string(),
  identifier: z.string(),
  type: z.string(),
});

export const CreateNewMessageParamsSchema = z
  .object({
    // Required fields
    role: UIMessageRoleTypeSchema,
    content: z.string(),
    // agentId is required, but can be resolved from sessionId in the router
    agentId: z.string().optional(),
    /**
     * @deprecated Use agentId instead. Will be resolved to agentId in the router.
     */
    sessionId: z.string().nullable().optional(),
    // Tool related
    tool_call_id: z.string().optional(),
    plugin: ChatPluginPayloadSchema.optional(),
    // Grouping
    parentId: z.string().optional(),
    groupId: z.string().nullable().optional(),
    // Context
    topicId: z.string().nullable().optional(),
    threadId: z.string().nullable().optional(),
    targetId: z.string().nullable().optional(),
    // Model info
    model: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    // Content
    files: z.array(z.string()).optional(),
    // Error handling
    error: ChatMessageErrorSchema.nullable().optional(),
    // Metadata
    traceId: z.string().optional(),
    fileChunks: z.array(SemanticSearchChunkSchema).optional(),
  })
  .passthrough();

export const UpdateMessagePluginSchema = z.object({
  id: z.string().optional(),
  toolCallId: z.string().optional(),
  type: z.string().optional(),
  intervention: ToolInterventionSchema.optional(),
  apiName: z.string().optional(),
  arguments: z.string().optional(),
  identifier: z.string().optional(),
  state: z.any().optional(),
  error: z.any().optional(),
  clientId: z.string().optional(),
  userId: z.string().optional(),
});
