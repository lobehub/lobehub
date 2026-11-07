import { type ChatContextContent } from '@lobechat/types';

import { type UploadFileItem } from '@/types/files/upload';

export interface ImageFileState {
  chatContextSelectionsByContext: Record<string, ChatContextContent[]>;
  /**
   * Composer uploads, one list per conversation (keyed like the composer's
   * draft), so an attachment stays with the conversation it was added to.
   */
  chatUploadFileListByContext: Record<string, UploadFileItem[]>;
  uploadingIds: string[];
}

export const initialImageFileState: ImageFileState = {
  chatContextSelectionsByContext: {},
  chatUploadFileListByContext: {},
  uploadingIds: [],
};
