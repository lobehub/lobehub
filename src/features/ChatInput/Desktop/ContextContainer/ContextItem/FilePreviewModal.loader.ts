import { isPdfFile } from '@/features/FileViewer/fileType';
import { preloadPDFRenderer } from '@/features/FileViewer/Renderer/PDF/loader';
import { type UploadFileItem } from '@/types/files/upload';

const importFilePreviewModal = () => import('./FilePreviewModal');

let filePreviewModalPromise: ReturnType<typeof importFilePreviewModal> | undefined;

export const preloadFilePreviewModal = (): ReturnType<typeof importFilePreviewModal> =>
  (filePreviewModalPromise ??= importFilePreviewModal().catch((error) => {
    filePreviewModalPromise = undefined;
    throw error;
  }));

export const openFilePreviewModal = async (file: UploadFileItem) => {
  const modalPromise = preloadFilePreviewModal();

  if (
    isPdfFile({
      fileName: file.file.name,
      fileType: file.file.type,
      path: file.previewUrl || file.fileUrl || file.base64Url,
    })
  ) {
    void preloadPDFRenderer().catch((error) => {
      console.error('Failed to preload the PDF renderer:', error);
    });
  }

  const { createFilePreviewModal } = await modalPromise;

  return createFilePreviewModal(file);
};
