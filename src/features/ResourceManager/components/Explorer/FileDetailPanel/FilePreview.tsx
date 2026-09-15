'use client';

import { Center, Empty } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileViewer from '@/features/FileViewer';
import { type FileListItem } from '@/types/files';

interface FilePreviewProps {
  file: FileListItem;
}

/**
 * Live preview of the selected resource inside the detail panel. Falls back
 * to a neutral hint for types the FileViewer cannot render.
 */
const FilePreview = memo<FilePreviewProps>(({ file }) => {
  const { t } = useTranslation('file');

  if (!file?.url)
    return (
      <Center height={'100%'} width={'100%'}>
        <Empty description={t('preview.unsupportedFileAndContact')} />
      </Center>
    );

  return <FileViewer {...file} id={file.fileId ?? file.id} />;
});

export default FilePreview;
