'use client';

import { memo } from 'react';

import FileNotFound from '@/features/FileNotFound';
import { fileManagerSelectors, useFileStore } from '@/store/file';

import Detail from '../FileDetail';

const FileDetail = memo<{ id: string }>(({ id }) => {
  const file = useFileStore(fileManagerSelectors.getFileById(id));

  // Absent from the scoped list = deleted or access revoked (e.g. switched
  // back to private) — show the terminal card instead of a blank pane.
  if (!file) return <FileNotFound />;

  return <Detail {...file} />;
});
export default FileDetail;
