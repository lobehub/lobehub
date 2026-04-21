'use client';

import { SESSION_CHAT_URL } from '@lobechat/const';
import {
  type OverlayDispatchMessagePayload,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { nanoid } from '@lobechat/utils';
import { memo, useCallback } from 'react';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';

import { createOverlayDispatchScreenshotFilename } from './overlayDispatch';
import { getOverlayDispatchStoreState } from './overlayDispatchStore';

const dataUrlToFile = async ({
  dataUrl,
  filename,
}: {
  dataUrl: string;
  filename: string;
}): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
};

/**
 * Receives screen-capture overlay submissions forwarded by the main process.
 * Route navigation and screenshot upload run in parallel; the target
 * conversation waits on `pendingDispatch.uploadStatus` before calling
 * `sendMessage`, so the user sees the chat page load while the upload
 * finishes in the background.
 */
const OverlayMessageDispatcher = memo(() => {
  const router = useQueryRoute();

  const handler = useCallback(
    async (payload: OverlayDispatchMessagePayload) => {
      const inboxAgentId = builtinAgentSelectors.inboxAgentId(useAgentStore.getState());
      const agentId = payload.agentId || inboxAgentId;
      if (!agentId) return;

      const dispatchId = nanoid();
      const screenshotFileNames = payload.captures.map((_, index) =>
        createOverlayDispatchScreenshotFilename(dispatchId, index),
      );
      const hasCaptures = payload.captures.length > 0;

      getOverlayDispatchStoreState().setPendingDispatch({
        agentId,
        dispatchId,
        prompt: payload.prompt,
        screenshotFileNames,
        uploadStatus: hasCaptures ? 'uploading' : 'ready',
      });

      const { activeAgentId, activeTopicId, switchTopic } = useChatStore.getState();
      if (activeAgentId === agentId && activeTopicId) {
        await switchTopic(null, { skipRefreshMessage: true });
      }

      // replace: true drops prev search params (e.g. a stale `message=`) so
      // MessageFromUrl's message-param effect cannot double-fire alongside
      // the overlay dispatch path.
      router.push(SESSION_CHAT_URL(agentId, false), { query: {}, replace: true });

      if (!hasCaptures) return;

      void (async () => {
        try {
          const files = await Promise.all(
            payload.captures.map((capture, index) =>
              dataUrlToFile({
                dataUrl: capture.dataUrl,
                filename: screenshotFileNames[index]!,
              }),
            ),
          );
          await useFileStore.getState().uploadChatFiles(files);
          getOverlayDispatchStoreState().markDispatchUploadComplete(dispatchId, 'ready');
        } catch (error) {
          console.warn('[OverlayMessageDispatcher] upload screenshot(s) failed:', error);
          getOverlayDispatchStoreState().markDispatchUploadComplete(dispatchId, 'failed');
        }
      })();
    },
    [router],
  );

  useWatchBroadcast('overlayDispatchMessage', handler);

  return null;
});

OverlayMessageDispatcher.displayName = 'OverlayMessageDispatcher';

export default OverlayMessageDispatcher;
