import type { UploadFileItem } from '@lobechat/types';

import { useFileStore } from '@/store/file';

/** Use the same upload path and file relation as images attached in the composer. */
export const uploadTalkFrame = async (
  file: File,
  agentId: string,
  signal: AbortSignal,
): Promise<UploadFileItem> => {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    const uploaded = await useFileStore.getState().uploadWithProgress({
      file,
      conversationAgentId: agentId,
      abortController: controller,
    });
    signal.throwIfAborted();
    if (!uploaded) throw new Error('Video frame upload failed');
    return {
      id: uploaded.id,
      file,
      fileUrl: uploaded.url,
      dimensions: uploaded.dimensions,
      status: 'success',
    };
  } finally {
    signal.removeEventListener('abort', abort);
  }
};
