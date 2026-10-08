'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import FileViewer from '@/features/FileViewer';
import ImageEditTools from '@/features/FileViewer/ImageEditTools';
import { fileManagerSelectors, useFileStore } from '@/store/file';

interface FilePreviewerProps {
  fileId?: string;
  onClose?: () => void;
}

const FilePreviewer = memo<FilePreviewerProps>(({ fileId, onClose }) => {
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: fetchedFile } = useFetchKnowledgeItem(fileId);
  const file = useFileStore(fileManagerSelectors.getFileById(fileId));

  const displayFile = file || fetchedFile;

  if (!fileId || !displayFile) return null;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <Flexbox flex={1} height={'100%'} style={{ overflow: 'auto' }}>
        <FileViewer {...displayFile} imageTools={<ImageEditTools />} onClose={onClose} />
      </Flexbox>
    </Flexbox>
  );
});

FilePreviewer.displayName = 'FilePreviewer';

export default FilePreviewer;
