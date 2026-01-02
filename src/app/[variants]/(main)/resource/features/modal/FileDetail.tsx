'use client';

import { memo } from 'react';

import { fileManagerSelectors, useFileStore } from '@/store/file';

import Detail from '../FileDetail';

const FileDetail = memo<{ id: string }>(({ id }) => {
  const file = useFileStore(fileManagerSelectors.getFileById(id));

  if (!file) return;

  return <Detail {...file} />;
});
export default FileDetail;
