import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useRef } from 'react';

import { fileChatSelectors, useFileStore } from '@/store/file';
import { UPLOAD_STATUS_SET } from '@/types/files/upload';

import { useAgentId } from '../../hooks/useAgentId';
import FileItem from '../FilePreview/FileItem';
import ContextItem from './ContextItem';
import SelectionItem from './SelectionItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-x: scroll;
    width: 100%;
  `,
  uploadingContainer: css`
    overflow-x: auto;
    width: 100%;
    padding-block: 8px;
  `,
}));

const ContextList = memo(() => {
  const agentId = useAgentId();
  const prevAgentIdRef = useRef<string | undefined>(undefined);
  const inputFilesList = useFileStore(fileChatSelectors.chatUploadFileList);
  const showFileList = useFileStore(fileChatSelectors.chatUploadFileListHasItem);
  const rawSelectionList = useFileStore(fileChatSelectors.chatContextSelections);
  const showSelectionList = useFileStore(fileChatSelectors.chatContextSelectionHasItem);
  const clearChatContextSelections = useFileStore((s) => s.clearChatContextSelections);


  // Clear selections only when agentId changes (not on initial mount)
  useEffect(() => {
    if (prevAgentIdRef.current !== undefined && prevAgentIdRef.current !== agentId) {
      clearChatContextSelections();
    }
    prevAgentIdRef.current = agentId;
  }, [agentId, clearChatContextSelections]);

  // Filter duplicates based on preview content
  const selectionList = rawSelectionList.filter(
    (item, index, self) => index === self.findIndex((t) => t.preview === item.preview),
  );

  // Separate files into uploading/error and completed
  const { uploadingFiles, completedFiles } = useMemo(() => {
    const uploading = inputFilesList.filter(
      (file) => UPLOAD_STATUS_SET.has(file.status) || file.status === 'error',
    );
    const completed = inputFilesList.filter(
      (file) => !UPLOAD_STATUS_SET.has(file.status) && file.status !== 'error',
    );
    return { completedFiles: completed, uploadingFiles: uploading };
  }, [inputFilesList]);

  const hasUploadingFiles = uploadingFiles.length > 0;
  const hasCompletedFiles = completedFiles.length > 0;
  const hasSelections = showSelectionList && selectionList.length > 0;

  if (!showFileList && !showSelectionList) return null;
  if (!hasUploadingFiles && !hasCompletedFiles && !hasSelections) return null;

  return (
    <Flexbox gap={0}>
      {/* Uploading/Error files - show with detailed FileItem */}
      {hasUploadingFiles && (
        <ScrollShadow
          hideScrollBar
          horizontal
          className={styles.uploadingContainer}
          orientation={'horizontal'}
          size={8}
        >
          <Flexbox horizontal gap={8}>
            {uploadingFiles.map((item) => (
              <FileItem key={item.id} {...item} />
            ))}
          </Flexbox>
        </ScrollShadow>
      )}

      {/* Completed files and selections - show with compact Tag */}
      {(hasCompletedFiles || hasSelections) && (
        <ScrollShadow
          hideScrollBar
          horizontal
          className={styles.container}
          orientation={'horizontal'}
          size={8}
        >
          <Flexbox
            horizontal
            gap={4}
            paddingInline={0}
            style={{ paddingBlockStart: 8 }}
            wrap={'wrap'}
          >
            {selectionList.map((item) => (
              <SelectionItem key={item.id} {...item} />
            ))}
            {completedFiles.map((item) => (
              <ContextItem key={item.id} {...item} />
            ))}
          </Flexbox>
        </ScrollShadow>
      )}
    </Flexbox>
  );
});

export default ContextList;
