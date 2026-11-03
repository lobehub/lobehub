import { isDesktop } from '@lobechat/const';

import { parseLocalFileHref } from '@/features/Conversation/Markdown/plugins/LocalFileLink/parse';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

interface UseLocalFileActionsParams {
  isDirectory?: boolean;
  /**
   * Web only: opens the file in the right-side portal through the agent's
   * bound device. Absent when no device can serve the read.
   */
  openInPortal?: () => void;
  path?: string;
  readonly?: boolean;
}

export const useLocalFileActions = ({
  isDirectory = false,
  openInPortal,
  path,
  readonly = false,
}: UseLocalFileActionsParams) => {
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);

  const parsed =
    isDesktop && !readonly && !isDirectory ? parseLocalFileHref(path, { workingDirectory }) : null;
  const allowExternalFilePreview =
    !!parsed && (!workingDirectory || parsed.workingDirectory !== workingDirectory);

  // The web app cannot reach the user's filesystem: Open / Show in Folder are
  // Electron IPC and do nothing there, so a file can only be previewed in the
  // portal — and only when a bound device serves the read.
  const webPreview = !isDesktop && !readonly && !isDirectory ? openInPortal : undefined;

  const handlePreview = () => {
    if (webPreview) return webPreview();
    if (!parsed) return;
    openLocalFile({
      allowExternalFilePreview,
      filePath: parsed.filePath,
      workingDirectory: parsed.workingDirectory,
    });
  };

  const handleOpenFile = () => {
    if (!path) return;
    localFileService.openLocalFileOrFolder(path, isDirectory);
  };

  const handleOpenFolder = () => {
    if (!path) return;
    localFileService.openFileFolder(path);
  };

  // Directories open in the system file manager (desktop only); files preview
  // in the portal. Nothing to do leaves the chip inert.
  const handleClick = readonly
    ? undefined
    : isDirectory
      ? isDesktop
        ? handleOpenFile
        : undefined
      : parsed || webPreview
        ? handlePreview
        : undefined;

  return {
    canOpenNatively: isDesktop && !readonly,
    canPreview: !!parsed || !!webPreview,
    handleClick,
    handleOpenFile,
    handleOpenFolder,
    handlePreview,
  };
};
