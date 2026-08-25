import { getRegisteredAttachment } from './attachmentRegistry';

const FILE_PROXY_PATH = /^\/f\/[^/]+$/;

interface FileDownloadUrlOptions {
  appOrigin?: string;
  baseUrl?: string;
  downloadUrl?: string;
  fileId?: string;
}

/**
 * The file proxy normally returns an inline preview URL. Opting into its download
 * response lets the browser stream the file and expose native progress instead of
 * waiting for the whole file to become a client-side Blob.
 */
export const getFileDownloadUrl = (url: string, options: FileDownloadUrlOptions = {}): string => {
  const baseUrl =
    options.baseUrl ?? (typeof window === 'undefined' ? undefined : window.location.href);

  try {
    const downloadUrl = new URL(options.downloadUrl ?? url, baseUrl);

    if (FILE_PROXY_PATH.test(downloadUrl.pathname)) {
      downloadUrl.searchParams.set('download', '1');
      return downloadUrl.toString();
    }

    if (options.fileId && options.appOrigin) {
      const proxyUrl = new URL(`/f/${encodeURIComponent(options.fileId)}`, options.appOrigin);
      proxyUrl.searchParams.set('download', '1');
      return proxyUrl.toString();
    }

    return url;
  } catch {
    return url;
  }
};

export const openFileDownload = (url: string): void => {
  // Keep this synchronous with the click gesture so popup blockers allow the download tab.
  const attachment = getRegisteredAttachment(url);
  window.open(
    getFileDownloadUrl(url, {
      appOrigin: window.location.origin,
      downloadUrl: attachment?.downloadUrl,
      fileId: attachment?.fileId,
    }),
    '_blank',
    'noopener,noreferrer',
  );
};
