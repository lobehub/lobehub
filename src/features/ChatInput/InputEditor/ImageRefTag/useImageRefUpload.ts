import { useMemo, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand';

import { useChatInputStoreApiOptional } from '@/features/ChatInput/store/apiContext';
import type { State } from '@/features/ChatInput/store/initialState';
import { fileChatSelectors, useFileStore } from '@/store/file';
import type { UploadFileItem } from '@/types/files/upload';

import { getImageUploadRefs } from '../../utils/imageUploads';

const EMPTY_SUBSCRIBE = () => () => {};

/**
 * The upload an inline image reference points at and its current number, both `undefined`
 * when the image is not in this composer's attachment list (removed, failed, or a draft
 * restored without its uploads).
 *
 * The reference also loads in editors outside a composer (e.g. editing a sent message),
 * where there is no chat input store and no upload list, so the store is read optionally —
 * reactively when it exists, like `useChatInputAgentId`.
 */
export const useImageRefUpload = (src: string): { number?: number; upload?: UploadFileItem } => {
  const storeApi = useChatInputStoreApiOptional() as StoreApi<State> | undefined;
  const contextKey = useSyncExternalStore(
    storeApi ? storeApi.subscribe : EMPTY_SUBSCRIBE,
    () => {
      const state = storeApi?.getState();
      return state?.uploadContextKey ?? state?.contextSelectionKey;
    },
    () => undefined,
  );

  const files = useFileStore(fileChatSelectors.chatUploadFileList(contextKey));

  return useMemo(
    () => ({
      number: getImageUploadRefs(files).get(src)?.number,
      upload: files.find((item) => item.previewUrl === src),
    }),
    [files, src],
  );
};
