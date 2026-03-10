'use client';

import { Modal } from '@lobehub/ui';
import { memo } from 'react';

import FileViewer from '@/features/FileViewer';
import { type UploadFileItem } from '@/types/files/upload';

interface FilePreviewModalProps {
  file: UploadFileItem;
  onClose: () => void;
  open: boolean;
}

const FilePreviewModal = memo<FilePreviewModalProps>(({ file, open, onClose }) => {
  // Get the best available URL for preview
  const previewUrl = file.previewUrl || file.fileUrl || file.base64Url || '';

  return (
    <Modal
      allowFullscreen
      centered
      destroyOnHidden
      footer={null}
      height={'80vh'}
      open={open}
      title={file.file.name}
      width={'min(90vw, 1024px)'}
      styles={{
        body: {
          height: '80vh',
          overflow: 'auto',
          padding: 0,
        },
      }}
      onCancel={onClose}
    >
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
    </Modal>
  );
});

FilePreviewModal.displayName = 'FilePreviewModal';

export default FilePreviewModal;
