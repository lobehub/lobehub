/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
import { UploadFileItem } from '../../files';
import { MessageSemanticSearchChunk } from '../../rag';
import { ChatMessageError } from '../common/base';
import { ChatPluginPayload } from '../common/tools';
import { UIChatMessage, UIMessageRoleType } from './chat';

export interface CreateMessageParams
  extends Partial<Omit<UIChatMessage, 'content' | 'role' | 'topicId' | 'chunksList'>> {
  content: string;
  error?: ChatMessageError | null;
  fileChunks?: MessageSemanticSearchChunk[];
  files?: string[];
  fromModel?: string;
  fromProvider?: string;
  groupId?: string;
  role: UIMessageRoleType;
  sessionId: string;
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
  // ========== Required fields ==========
  role: UIMessageRoleType;
  content: string;
  sessionId: string;

  // ========== Tool related ==========
  tool_call_id?: string;
  plugin?: ChatPluginPayload;

  // ========== Grouping ==========
  parentId?: string;
  groupId?: string;

  // ========== Context ==========
  topicId?: string;
  threadId?: string;
  targetId?: string | null;

  // ========== Model info ==========
  model?: string;
  provider?: string;

  // ========== Content ==========
  files?: string[];

  // ========== Error handling ==========
  error?: ChatMessageError | null;

  // ========== Metadata ==========
  traceId?: string;
  fileChunks?: MessageSemanticSearchChunk[];
}

export interface SendMessageParams {
  /**
   * create a thread
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
   * Additional metadata for the message (e.g., mentioned users)
   */
  metadata?: Record<string, any>;
  onlyAddUserMessage?: boolean;
}

export interface SendThreadMessageParams {
  /**
   * create a thread
   */
  createNewThread?: boolean;
  // files?: UploadFileItem[];
  message: string;
  onlyAddUserMessage?: boolean;
}

export interface SendGroupMessageParams {
  files?: UploadFileItem[];
  groupId: string;
  message: string;
  /**
   * Additional metadata for the message (e.g., mentioned users)
   */
  metadata?: Record<string, any>;
  onlyAddUserMessage?: boolean;
  /**
   * for group chat
   */
  targetMemberId?: string | null;
}
