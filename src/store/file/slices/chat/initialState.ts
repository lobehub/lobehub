import { type ChatContextContent } from '@lobechat/types';

import { type UploadFileItem } from '@/types/files/upload';

export interface ImageFileState {
  chatContextSelectionsByContext: Record<string, ChatContextContent[]>;
  chatUploadFileList: UploadFileItem[];
  uploadingIds: string[];
}

export const initialImageFileState: ImageFileState = {
  chatContextSelectionsByContext: {},
  chatUploadFileList: [],
  uploadingIds: [],
};
