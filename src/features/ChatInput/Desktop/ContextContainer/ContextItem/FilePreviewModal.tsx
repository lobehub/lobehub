'use client';

import { createModal } from '@lobehub/ui/base-ui';

import FileViewer from '@/features/FileViewer';
import { type UploadFileItem } from '@/types/files/upload';

const FilePreviewModalContent = ({ file }: { file: UploadFileItem }) => {
  // Get the best available URL for preview
  const previewUrl = file.previewUrl || file.fileUrl || file.base64Url || '';

  return (
    <FileViewer
      chunkCount={null}
      chunkingError={null}
      createdAt={new Date()}
      embeddingError={null}
      fileType={file.file.type}
      finishEmbedding={false}
      id={file.id}
      name={file.file.name}
      size={file.file.size}
      sourceType="upload"
      updatedAt={new Date()}
      url={previewUrl}
    />
  );
};

export const createFilePreviewModal = (file: UploadFileItem) =>
  createModal({
    content: <FilePreviewModalContent file={file} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { height: '80vh', minHeight: 0, overflow: 'auto', padding: 0 },
    },
    title: file.file.name,
    width: 'min(90vw, 1024px)',
  });
