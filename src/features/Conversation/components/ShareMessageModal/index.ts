import { type UIChatMessage } from '@lobechat/types';
import { type ModalInstance } from '@lobehub/ui';

import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

import type { createStore } from '../../store';

// The modal renders a message as an image, text and PDF, so the screenshot
// library and pdf.js come with it. Every surface that lists messages reaches
// this entry through its action bar; load the modal on click, not with the list.
const importShareMessageModal = () => import('./Modal');

let shareMessageModalPromise: ReturnType<typeof importShareMessageModal> | undefined;

export const preloadShareMessageModal = (): ReturnType<typeof importShareMessageModal> =>
  (shareMessageModalPromise ??= importShareMessageModal().catch((error) => {
    shareMessageModalPromise = undefined;
    throw error;
  }));

let pendingOpen: Promise<ModalInstance | undefined> | undefined;

/**
 * Open the share modal for a message. Callers fire and forget, so this is the
 * click's boundary:
 *
 * - Clicks made while the chunk loads join the open in flight. Before the split
 *   the first click put the modal and its mask up synchronously; without this
 *   each waiting click would stack its own modal once the chunk resolves.
 * - A chunk that fails to load (a flaky network, or a deploy that retired it)
 *   goes through the app's chunk recovery — reload once, then a refresh toast —
 *   rather than leaving the click silently dead. Other failures still throw.
 */
export const openShareMessageModal = (
  message: UIChatMessage,
  createConversationStore: () => ReturnType<typeof createStore>,
): Promise<ModalInstance | undefined> =>
  (pendingOpen ??= preloadShareMessageModal()
    .then(({ openShareMessageModal: createShareMessageModal }) =>
      createShareMessageModal(message, createConversationStore),
    )
    .catch((error) => {
      if (!isChunkLoadError(error)) throw error;

      notifyChunkError(error);
      return undefined;
    })
    .finally(() => {
      pendingOpen = undefined;
    }));
