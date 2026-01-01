'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import FileViewer from '@/features/FileViewer';
import { fileManagerSelectors, useFileStore } from '@/store/file';

import FileDetail from './FileDetail';

interface FilePreviewerProps {
  fileId?: string;
}

const FilePreviewer = memo<FilePreviewerProps>(({ fileId }) => {
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: fetchedFile } = useFetchKnowledgeItem(fileId);
  const file = useFileStore(fileManagerSelectors.getFileById(fileId));

  const displayFile = file || fetchedFile;

  if (!fileId || !displayFile) return null;

  return (
    <Flexbox height={'100%'} horizontal width={'100%'}>
      <Flexbox flex={1} height={'100%'} style={{ overflow: 'auto' }}>
        <FileViewer {...displayFile} />
      </Flexbox>
      <FileDetail id={fileId} />
    </Flexbox>
  );
});

FilePreviewer.displayName = 'FilePreviewer';

export default FilePreviewer;
