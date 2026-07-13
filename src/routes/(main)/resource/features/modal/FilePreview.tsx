'use client';

import { memo } from 'react';

import FileNotFound from '@/features/FileNotFound';
import FileViewer from '@/features/FileViewer';
import { fileManagerSelectors, useFileStore } from '@/store/file';

const FilePreview = memo<{ id: string }>(({ id }) => {
  const file = useFileStore(fileManagerSelectors.getFileById(id));

  // Absent from the scoped list = deleted or access revoked (e.g. switched
  // back to private) — show the terminal card instead of a blank pane.
  if (!file) return <FileNotFound />;

  return <FileViewer {...file} />;
});

export default FilePreview;
