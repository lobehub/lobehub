import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { mutate as globalMutate } from '@/libs/swr';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useLocalFilePreviewStore } from '@/store/localFilePreview';

import { matchLocalFilePreviewKey } from './previewKeyMatcher';

export const useLocalFileMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const file = useChatStore(chatPortalSelectors.currentLocalFile);

  if (!file) return;

  // A local file has no server id or shareable URL — its handle is the path.
  return {
    copyPath: file.filePath,
    // The portal body's preview is a replica; inline image previews of the same
    // file (markdown images, chat-input tags) are plain SWR queries.
    refresh: () =>
      Promise.all([
        useLocalFilePreviewStore
          .getState()
          .refreshPreview({ ...file, allowExternalFile: file.allowExternalFilePreview }),
        globalMutate(matchLocalFilePreviewKey(file)),
      ]),
  };
};
