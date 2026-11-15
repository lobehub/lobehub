import type { IEditor } from '@lobehub/editor';
import { useEffect, useRef } from 'react';

import { useChatInputUploadKey } from '@/features/ChatInput/hooks/useChatInputUpload';
import { fileChatSelectors, useFileStore } from '@/store/file';
import type { UploadFileItem } from '@/types/files/upload';

import { getImageUploadRefs } from '../../utils/imageUploads';
import type { SyncImageRefTagsPayload } from './ImageRefTagPlugin';
import { SYNC_IMAGE_REF_TAGS_COMMAND } from './ImageRefTagPlugin';

/** Uploads that started in this composer, as opposed to attachments restored from a message. */
const isNewUpload = (item: UploadFileItem | undefined) =>
  item?.status === 'pending' || item?.status === 'uploading' || item?.status === 'processing';

export interface ImageRefSyncOptions {
  /**
   * Whether newly attached images are referenced at the caret. Off on mobile, which has no
   * numbered image cards; existing references (e.g. from a restored message) still follow
   * removals and renumbering there.
   */
  insertNew?: boolean;
}

export interface ImageRefSyncState {
  /** Preview URLs of the images attached at the last sync. */
  attached: Set<string>;
  /** Upload list the state belongs to. */
  key?: string;
  /** Preview URLs ever attached to this list, so a reference is inserted at most once. */
  seen: Set<string>;
}

/**
 * What to change after the attachment list changed from `previous` to `files`.
 *
 * Only a change within the same upload list inserts or removes references. Moving to
 * another list (switching conversations) only adopts its images: the draft restored there
 * keeps its references, and they are renumbered once those images are listed.
 */
export const planImageRefSync = (
  files: UploadFileItem[],
  key: string | undefined,
  previous: ImageRefSyncState | null,
  { insertNew = true }: ImageRefSyncOptions = {},
): { payload: SyncImageRefTagsPayload; state: ImageRefSyncState } => {
  const refs = getImageUploadRefs(files);
  const attached = new Set(refs.keys());

  if (!previous || previous.key !== key) {
    return { payload: { refs }, state: { attached, key, seen: new Set(attached) } };
  }

  const removed = [...previous.attached].filter((src) => !attached.has(src));
  const insert = [...attached].filter(
    (src) =>
      insertNew &&
      !previous.seen.has(src) &&
      isNewUpload(files.find((file) => file.previewUrl === src)),
  );

  return {
    payload: { insert, refs, removed },
    state: { attached, key, seen: new Set([...previous.seen, ...attached]) },
  };
};

/**
 * Keeps the editor's inline image references in step with the draft's image uploads: a
 * newly attached image is referenced at the caret, a removed image takes its references
 * with it, and the remaining references follow the images' new numbers.
 */
export const useImageRefTagSync = (
  editor: IEditor | undefined,
  { insertNew = true }: ImageRefSyncOptions = {},
) => {
  const key = useChatInputUploadKey();
  const files = useFileStore(fileChatSelectors.chatUploadFileList(key));
  const stateRef = useRef<ImageRefSyncState | null>(null);

  useEffect(() => {
    if (!editor) return;

    const { payload, state } = planImageRefSync(files, key, stateRef.current, {
      insertNew,
    });
    stateRef.current = state;
    editor.dispatchCommand(SYNC_IMAGE_REF_TAGS_COMMAND, payload);
  }, [editor, files, insertNew, key]);
};
