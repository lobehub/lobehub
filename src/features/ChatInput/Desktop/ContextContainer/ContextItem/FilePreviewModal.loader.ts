import { createRawModal } from '@lobehub/ui';

import { isPdfFile } from '@/features/FileViewer/fileType';
import { preloadPDFRenderer } from '@/features/FileViewer/Renderer/PDF/loader';
import { type UploadFileItem } from '@/types/files/upload';

const importFilePreviewModal = () => import('./FilePreviewModal');

let filePreviewModalPromise: ReturnType<typeof importFilePreviewModal> | undefined;

export const preloadFilePreviewModal = (): ReturnType<typeof importFilePreviewModal> =>
  (filePreviewModalPromise ??= importFilePreviewModal());

export const openFilePreviewModal = async (file: UploadFileItem) => {
  const modalPromise = preloadFilePreviewModal();

  if (
    isPdfFile({
      fileName: file.file.name,
      fileType: file.file.type,
      path: file.previewUrl || file.fileUrl || file.base64Url,
    })
  ) {
    void preloadPDFRenderer().catch(() => undefined);
  }

  const { default: FilePreviewModal } = await modalPromise;

  return createRawModal(FilePreviewModal, { file });
};
