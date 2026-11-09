import { type ChatContextContent, type PageSelection, type UIChatMessage } from '@lobechat/types';

import { type ChatGroupAgentItem } from '@/database/schemas/chatGroup';
import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type ConversationMessagePage } from '@/services/message/replica';
import { type UploadFileItem } from '@/types/files/upload';

import { type TranscriptPaging } from './transcript/lens';

export interface FailedSendDraft {
  contextSelections?: ChatContextContent[];
  createdAt?: number;
  editorData?: Record<string, unknown>;
  files?: UploadFileItem[];
  id: string;
  message: string;
  pageSelections?: PageSelection[];
}

export interface ChatMessageState {
  activeAgentId: string;
  /**
   * Raw messages from database (flat structure)
   */
  dbMessagesMap: Record<string, UIChatMessage[]>;
  /** Refused sends kept separately from a newer composer draft, scoped by messageMapKey. */
  failedSendDrafts: Record<string, FailedSendDraft[]>;
  /**
   * Group agents maps by group ID
   */
  groupAgentMaps: Record<string, ChatGroupAgentItem[]>;
  isCreatingMessage: boolean;
  /**
   * is the message is editing
   */
  messageEditingIds: string[];
  /**
   * Paging bookkeeping of each transcript entry (cursor of the next older
   * page, loaded depth), keyed by the transcript entry key. The rows are the
   * entry's `dbMessagesMap` bucket.
   */
  messagePagingMap: Record<string, TranscriptPaging>;
  /**
   * Replica bookkeeping of the transcripts (`dbMessagesMap` + `messagesMap` +
   * `messagePagingMap` are its view).
   */
  messageReplica: ReplicaState<ConversationMessagePage>;
  /**
   * whether messages have fetched
   */
  messagesInit: boolean;
  /**
   * Parsed messages for display (includes assistantGroup from conversation-flow)
   */
  messagesMap: Record<string, UIChatMessage[]>;
}

export const initialMessageState: ChatMessageState = {
  activeAgentId: '',
  dbMessagesMap: {},
  failedSendDrafts: {},
  groupAgentMaps: {},
  isCreatingMessage: false,
  messageEditingIds: [],
  messagePagingMap: {},
  messageReplica: createReplicaState(),
  messagesInit: false,
  messagesMap: {},
};
