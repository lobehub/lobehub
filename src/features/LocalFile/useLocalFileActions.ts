import { isDesktop } from '@lobechat/const';

import { parseLocalFileHref } from '@/features/Conversation/Markdown/plugins/LocalFileLink/parse';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

interface UseLocalFileActionsParams {
  isDirectory?: boolean;
  path?: string;
  readonly?: boolean;
}

export const useLocalFileActions = ({
  isDirectory = false,
  path,
  readonly = false,
}: UseLocalFileActionsParams) => {
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);

  const parsed =
    isDesktop && !readonly && !isDirectory ? parseLocalFileHref(path, { workingDirectory }) : null;
  const allowExternalFilePreview =
    !!parsed && (!workingDirectory || parsed.workingDirectory !== workingDirectory);

  const handlePreview = () => {
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

  const handleClick = readonly
    ? undefined
    : () => {
        if (isDirectory) return handleOpenFile();
        if (parsed) return handlePreview();
      };

  return {
    canPreview: !!parsed,
    handleClick,
    handleOpenFile,
    handleOpenFolder,
    handlePreview,
  };
};
