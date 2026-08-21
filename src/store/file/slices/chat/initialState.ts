import { type ChatContextContent } from '@lobechat/types';

import { type UploadFileItem } from '@/types/files/upload';

/**
 * Bucket used when a caller has no context of its own.
 *
 * Every chat surface passes the key its composer is scoped to; this only
 * catches hosts that predate the split, so their drafts stay together in one
 * bucket instead of vanishing from the UI that uploaded them.
 */
export const DEFAULT_CHAT_UPLOAD_CONTEXT = 'default';

export interface ImageFileState {
  chatContextSelectionsByContext: Record<string, ChatContextContent[]>;
  /**
   * Pending composer uploads, keyed by the SAME context key as
   * `chatContextSelectionsByContext` (`messageMapKey({agentId, groupId,
   * topicId})`, or the home input's own key).
   *
   * Keyed rather than flat because a client renders more than one composer at a
   * time — a split view, a second desktop tab, the portal — and a flat list made
   * every one of them show the same pending file, send another composer's
   * attachment with their own message, and clear each other's drafts.
   */
  chatUploadFileListByContext: Record<string, UploadFileItem[]>;
  uploadingIds: string[];
}

export const initialImageFileState: ImageFileState = {
  chatContextSelectionsByContext: {},
  chatUploadFileListByContext: {},
  uploadingIds: [],
};
