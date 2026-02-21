import { produce } from 'immer';

import {
  type FileUploadState,
  type FileUploadStatus,
  type UploadFileItem,
} from '@/types/files/upload';

interface AddFile {
  atStart?: boolean;
  file: UploadFileItem;
  type: 'addFile';
}

interface AddFiles {
  atStart?: boolean;
  files: UploadFileItem[];
  type: 'addFiles';
}

interface UpdateFile {
  id: string;
  type: 'updateFile';
  value: Partial<UploadFileItem>;
}

interface UpdateFileStatus {
  id: string;
  status: FileUploadStatus;
  type: 'updateFileStatus';
}

interface UpdateFileUploadState {
  id: string;
  type: 'updateFileUploadState';
  uploadState: FileUploadState;
}

interface RemoveFile {
  id: string;
  type: 'removeFile';
}

interface RemoveFiles {
  ids: string[];
  type: 'removeFiles';
}

export type UploadFileListDispatch =
  | AddFile
  | UpdateFileStatus
  | UpdateFileUploadState
  | RemoveFile
  | AddFiles
  | UpdateFile
  | RemoveFiles;

export const uploadFileListReducer = (
  state: UploadFileItem[],
  action: UploadFileListDispatch,
): UploadFileItem[] => {
  switch (action.type) {
    case 'addFile': {
      return produce(state, (draftState) => {
        const { atStart, file } = action;

        if (atStart) {
          draftState.unshift(file);
        } else {
          draftState.push(file);
        }
      });
    }

    case 'addFiles': {
      return produce(state, (draftState) => {
        const { atStart, files } = action;

        for (const file of files) {
          if (atStart) {
            draftState.unshift(file);
          } else {
            draftState.push(file);
          }
        }
      });
    }
    case 'updateFile': {
      return produce(state, (draftState) => {
        const file = draftState.find((f) => f.id === action.id);
        if (file) {
          Object.assign(file, action.value);
        }
      });
    }

    case 'updateFileStatus': {
      return produce(state, (draftState) => {
        const file = draftState.find((f) => f.id === action.id);
        if (file) {
          file.status = action.status;
        }
      });
    }
    case 'updateFileUploadState': {
      return produce(state, (draftState) => {
        const file = draftState.find((f) => f.id === action.id);
        if (file) {
          file.uploadState = action.uploadState;
        }
      });
    }

    case 'removeFile': {
      return produce(state, (draftState) => {
        const index = draftState.findIndex((f) => f.id === action.id);
        if (index !== -1) {
          draftState.splice(index, 1);
        }
      });
    }

    case 'removeFiles': {
      return produce(state, (draftState) => {
        for (const id of action.ids) {
          const index = draftState.findIndex((f) => f.id === id);
          if (index !== -1) {
            draftState.splice(index, 1);
          }
        }
      });
    }
    default: {
      throw new Error('Unhandled action type');
    }
  }
};
