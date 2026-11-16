import type { IEditor } from '@lobehub/editor';
import { COMMAND_PRIORITY_EDITOR } from 'lexical';
import { useEffect, useRef } from 'react';

import { useChatInputUploadKey } from '@/features/ChatInput/hooks/useChatInputUpload';
import { fileChatSelectors, useFileStore } from '@/store/file';
import type { UploadFileItem } from '@/types/files/upload';

import { getImageUploadRefs } from '../../utils/imageUploads';
import type { SyncImageRefTagsPayload } from './ImageRefTagPlugin';
import { IMAGE_REFS_DELETED_COMMAND, SYNC_IMAGE_REF_TAGS_COMMAND } from './ImageRefTagPlugin';

export interface ImageRefSyncState {
  /** Preview URLs of the images attached at the last sync. */
  attached: Set<string>;
  /** Upload list the state belongs to. */
  key?: string;
}

/**
 * What to change after the attachment list changed from `previous` to `files`.
 *
 * Only a change within the same upload list removes references. Moving to another list
 * (switching conversations) only adopts its images: the draft restored there keeps its
 * references, and they are renumbered once those images are listed.
 */
export const planImageRefSync = (
  files: UploadFileItem[],
  key: string | undefined,
  previous: ImageRefSyncState | null,
): { payload: SyncImageRefTagsPayload; state: ImageRefSyncState } => {
  const refs = getImageUploadRefs(files);
  const attached = new Set(refs.keys());

  if (!previous || previous.key !== key) {
    return { payload: { refs }, state: { attached, key } };
  }

  const removed = [...previous.attached].filter((src) => !attached.has(src));

  return { payload: { refs, removed }, state: { attached, key } };
};

/**
 * Keeps inline image references already in the draft (from editor data saved before new
 * references stopped being inserted) in step with the draft's image uploads: a removed image
 * takes its references with it, and the remaining references follow the images' new numbers.
 * Attaching an image adds no reference.
 * Deleting an image's last reference from the text removes the image.
 */
export const useImageRefTagSync = (editor: IEditor | undefined) => {
  const key = useChatInputUploadKey();
  const files = useFileStore(fileChatSelectors.chatUploadFileList(key));
  const stateRef = useRef<ImageRefSyncState | null>(null);

  useEffect(() => {
    if (!editor) return;

    const { payload, state } = planImageRefSync(files, key, stateRef.current);
    stateRef.current = state;
    editor.dispatchCommand(SYNC_IMAGE_REF_TAGS_COMMAND, payload);
  }, [editor, files, key]);

  useEffect(() => {
    const lexical = editor?.getLexicalEditor();
    if (!lexical || !key) return;

    return lexical.registerCommand(
      IMAGE_REFS_DELETED_COMMAND,
      (srcs) => {
        const state = useFileStore.getState();
        const list = fileChatSelectors.chatUploadFileList(key)(state);
        for (const file of list) {
          if (file.previewUrl && srcs.includes(file.previewUrl)) {
            void state.removeChatUploadFile(key, file.id);
          }
        }
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor, key]);
};
