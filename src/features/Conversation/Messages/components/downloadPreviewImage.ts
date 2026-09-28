import { downloadFile } from '@lobechat/utils/client';

import { getFileDownloadUrl } from '@/features/EditorCanvas/fileDownload';

const fileNameFromUrl = (source: string) => {
  try {
    const name = new URL(source, window.location.href).pathname.split('/').pop();
    return name ? decodeURIComponent(name) : 'image';
  } catch {
    return 'image';
  }
};

export const downloadPreviewImage = async (source: string) => {
  const downloadUrl = getFileDownloadUrl(source, { appOrigin: window.location.origin });

  // The file proxy redirects to a presigned URL on an origin that sends no CORS
  // headers — and a cross-origin redirect strips the Origin header to `null`, so
  // no bucket rule can allow it either. Its `download=1` response carries a
  // Content-Disposition instead, which saves the file under its stored name.
  if (downloadUrl !== source) {
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  await downloadFile(source, fileNameFromUrl(source));
};
