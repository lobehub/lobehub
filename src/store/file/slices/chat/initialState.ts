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
  /**
   * Which composer each IN-FLIGHT upload is writing into, keyed by a per-call
   * session id.
   *
   * An upload spends its first moments reading and compressing the file, before
   * any pending item exists — and a send during that window mints the topic and
   * moves the bucket. A dispatch bound to the key captured at call time would
   * then land in the abandoned bucket: the attachment disappears, or (when the
   * move lands between two progress callbacks) a moved item never leaves
   * `pending` and jams the send button. Redirecting by SESSION rather than by
   * key is what makes the retarget safe — `main_<agent>_new` is reused by the
   * next new topic, so a key-to-key redirect would misfile that one instead.
   */
  chatUploadSessionContext: Record<string, string>;
  uploadingIds: string[];
}

export const initialImageFileState: ImageFileState = {
  chatContextSelectionsByContext: {},
  chatUploadFileListByContext: {},
  chatUploadSessionContext: {},
  uploadingIds: [],
};
