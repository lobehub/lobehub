'use client';

import { memo } from 'react';

import FileDetailComponent from '@/app/[variants]/(main)/resource/features/FileDetail';
import { fileManagerSelectors, useFileStore } from '@/store/file';

interface FileDetailProps {
  id: string;
}

const FileDetail = memo<FileDetailProps>(({ id }) => {
  const file = useFileStore(fileManagerSelectors.getFileById(id));

  if (!file) return null;

  return <FileDetailComponent {...file} />;
});

FileDetail.displayName = 'FileDetail';

export default FileDetail;
