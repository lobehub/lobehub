import { type UploadFileItem } from '@/types/files/upload';

export type OverlayUploadStatus = 'uploading' | 'ready' | 'failed';

export interface PendingOverlayDispatch {
  agentId: string;
  dispatchId: string;
  prompt: string;
  screenshotFileNames: string[];
  uploadStatus: OverlayUploadStatus;
}

interface CanConsumePendingOverlayDispatchParams {
  agentId?: string | null;
  isAgentConfigLoading: boolean;
  messagesInit: boolean;
  pendingDispatch: PendingOverlayDispatch | null;
  routeAgentId?: string | null;
  topicId?: string | null;
}

interface SelectPendingOverlayDispatchFilesParams {
  fileList: readonly UploadFileItem[];
  pendingDispatch: PendingOverlayDispatch;
}

export const createOverlayScreenshotFilename = (dispatchId: string, index = 0) =>
  `screen-capture-${dispatchId}-${index + 1}.png`;

export const createOverlayDispatchScreenshotFilename = createOverlayScreenshotFilename;

export const canConsumePendingOverlayDispatch = ({
  agentId,
  isAgentConfigLoading,
  messagesInit,
  pendingDispatch,
  routeAgentId,
  topicId,
}: CanConsumePendingOverlayDispatchParams) => {
  if (!pendingDispatch || !agentId) return false;
  if (pendingDispatch.agentId !== agentId) return false;
  if (routeAgentId && routeAgentId !== agentId) return false;
  if (pendingDispatch.uploadStatus === 'uploading') return false;

  const isNewConversation = !topicId;

  return !isAgentConfigLoading && (isNewConversation || messagesInit);
};

export const selectPendingOverlayDispatchFiles = ({
  fileList,
  pendingDispatch,
}: SelectPendingOverlayDispatchFilesParams) => {
  const fileMap = new Map(fileList.map((file) => [file.file?.name, file] as const));

  return pendingDispatch.screenshotFileNames.flatMap((fileName) => {
    const file = fileMap.get(fileName);
    return file ? [file] : [];
  });
};
