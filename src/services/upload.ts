import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import { parseDataUri } from '@lobechat/model-runtime/utils/uriParser';
import { uuid } from '@lobechat/utils';
import dayjs from 'dayjs';
import { sha256 } from 'js-sha256';

import { fileEnv } from '@/envs/file';
import { lambdaClient } from '@/libs/trpc/client';
import type { FileMetadata, UploadBase64ToS3Result } from '@/types/files';
import type { FileUploadState, FileUploadStatus } from '@/types/files/upload';

export const UPLOAD_NETWORK_ERROR = 'NetWorkError';

const MAX_MULTIPART_PARTS = 10_000;
const HASH_BUFFER_SIZE = 4 * 1024 * 1024;
const MULTIPART_PART_SIZE = 32 * 1024 * 1024;
const MULTIPART_UPLOAD_THRESHOLD = 64 * 1024 * 1024;

export const hashFile = async (file: File, signal?: AbortSignal): Promise<string> => {
  const hasher = sha256.create();
  const reader = file.stream().getReader({ mode: 'byob' });
  let buffer = new ArrayBuffer(HASH_BUFFER_SIZE);

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error('Upload cancelled by user');

      const { done, value } = await reader.read(new Uint8Array(buffer));
      if (done) return hasher.hex();
      hasher.update(value);
      buffer = value.buffer as ArrayBuffer;
    }
  } finally {
    reader.releaseLock();
  }
};

/**
 * Generate file storage path metadata for S3-compatible storage
 * @param originalFilename - Original filename
 * @param options - Path generation options
 * @returns Path metadata including date, dirname, filename, and pathname
 */
const generateFilePathMetadata = (
  originalFilename: string,
  options: { directory?: string; pathname?: string } = {},
): {
  date: string;
  dirname: string;
  filename: string;
  pathname: string;
} => {
  // Generate unique filename with UUID prefix and original extension
  const extension = originalFilename.split('.').at(-1);
  const filename = `${uuid()}.${extension}`;

  // Generate timestamp-based directory path
  const date = (Date.now() / 1000 / 60 / 60).toFixed(0);
  const dirname = `${options.directory || fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/${date}`;
  const pathname = options.pathname ?? `${dirname}/${filename}`;

  return {
    date,
    dirname,
    filename,
    pathname,
  };
};

interface UploadFileToS3Options {
  abortController?: AbortController;
  directory?: string;
  filename?: string;
  onNotSupported?: () => void;
  onProgress?: (status: FileUploadStatus, state: FileUploadState) => void;
  pathname?: string;
  skipCheckFileType?: boolean;
}

class UploadService {
  /**
   * uniform upload method for both server and client
   */
  uploadFileToS3 = async (
    file: File,
    { onProgress, directory, pathname, abortController }: UploadFileToS3Options,
  ): Promise<{ data: FileMetadata; success: boolean }> => {
    if (file.size > MAX_UPLOAD_FILE_SIZE) throw new Error(UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE);

    // Server-side upload logic

    // if is server mode, upload to server s3,

    const data = await this.uploadToServerS3(file, {
      abortController,
      directory,
      onProgress,
      pathname,
    });
    return { data, success: true };
  };

  uploadBase64ToS3 = async (
    base64Data: string,
    options: UploadFileToS3Options = {},
  ): Promise<UploadBase64ToS3Result> => {
    // Parse base64 data
    const { base64, mimeType, type } = parseDataUri(base64Data);

    if (!base64 || !mimeType || type !== 'base64') {
      throw new Error('Invalid base64 data for image');
    }

    // Convert base64 to Blob
    const byteCharacters = atob(base64);
    const byteArrays = [];

    // Process in chunks to avoid memory issues
    for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
      const slice = byteCharacters.slice(offset, offset + 1024);

      const byteNumbers: number[] = Array.from({ length: slice.length });
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    const blob = new Blob(byteArrays, { type: mimeType });

    // Determine file extension
    const fileExtension = mimeType.split('/')[1] || 'png';
    const fileName = `${options.filename || `image_${dayjs().format('YYYY-MM-DD-hh-mm-ss')}`}.${fileExtension}`;

    // Create file object
    const file = new File([blob], fileName, { type: mimeType });

    // Use unified upload method
    const { data: metadata } = await this.uploadFileToS3(file, options);
    const hash = await hashFile(file, options.abortController?.signal);

    return {
      fileType: mimeType,
      hash,
      metadata,
      size: file.size,
    };
  };

  uploadDataToS3 = async (data: object, options: UploadFileToS3Options = {}) => {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], options.filename || 'data.json', { type: 'application/json' });
    return await this.uploadFileToS3(file, options);
  };

  uploadToServerS3 = async (
    file: File,
    {
      onProgress,
      directory,
      pathname,
      abortController,
    }: {
      abortController?: AbortController;
      directory?: string;
      onProgress?: (status: FileUploadStatus, state: FileUploadState) => void;
      pathname?: string;
    },
  ): Promise<FileMetadata> => {
    const {
      date,
      dirname,
      filename,
      pathname: uploadPathname,
    } = generateFilePathMetadata(file.name, { directory, pathname });
    const result = { date, dirname, filename, path: uploadPathname };
    const startTime = Date.now();

    try {
      if (file.size >= MULTIPART_UPLOAD_THRESHOLD) {
        await this.uploadMultipart(file, uploadPathname, abortController?.signal, (loaded) => {
          onProgress?.('uploading', this.getUploadState(loaded, file.size, startTime));
        });
      } else {
        const preSignUrl = await lambdaClient.upload.createS3PreSignedUrl.mutate({
          pathname: uploadPathname,
          size: file.size,
        });

        await this.putBlob(
          preSignUrl,
          file,
          abortController?.signal,
          (loaded) => {
            onProgress?.('uploading', this.getUploadState(loaded, file.size, startTime));
          },
          file.type,
        );
      }
    } catch (error) {
      if (abortController?.signal.aborted) {
        onProgress?.('cancelled', { progress: 0, restTime: 0, speed: 0 });
      }
      throw error;
    }

    onProgress?.('success', {
      progress: 100,
      restTime: 0,
      speed: file.size / Math.max((Date.now() - startTime) / 1000, 0.001),
    });

    return result;
  };

  private getUploadState = (loaded: number, total: number, startTime: number): FileUploadState => {
    const elapsed = Math.max((Date.now() - startTime) / 1000, 0.001);
    const speed = loaded / elapsed;
    const progress = total > 0 ? Number(((loaded / total) * 100).toFixed(1)) : 0;

    return {
      progress: progress === 100 ? 99.9 : progress,
      restTime: speed > 0 ? (total - loaded) / speed : 0,
      speed,
    };
  };

  private putBlob = async (
    url: string,
    blob: Blob,
    signal: AbortSignal | undefined,
    onProgress: (loaded: number) => void,
    contentType?: string,
  ): Promise<string | undefined> => {
    if (signal?.aborted) throw signal.reason ?? new Error('Upload cancelled by user');

    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      return await new Promise<string | undefined>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) onProgress(event.loaded);
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.getResponseHeader?.('ETag') || undefined);
          } else reject(xhr.statusText);
        });
        xhr.addEventListener('error', () => {
          if (xhr.status === 0) reject(UPLOAD_NETWORK_ERROR);
          else reject(xhr.statusText);
        });
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled by user')));
        xhr.open('PUT', url);
        if (contentType) xhr.setRequestHeader('Content-Type', contentType);
        xhr.send(blob);
      });
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };

  private uploadMultipart = async (
    file: File,
    pathname: string,
    signal: AbortSignal | undefined,
    onProgress: (loaded: number) => void,
  ): Promise<void> => {
    const partSize = Math.max(MULTIPART_PART_SIZE, Math.ceil(file.size / MAX_MULTIPART_PARTS));
    const partCount = Math.ceil(file.size / partSize);
    const parts: Array<{ etag: string; partNumber: number }> = [];
    const { uploadId } = await lambdaClient.upload.createS3MultipartUpload.mutate({
      contentType: file.type || undefined,
      pathname,
      size: file.size,
    });

    try {
      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        if (signal?.aborted) throw signal.reason ?? new Error('Upload cancelled by user');

        const offset = (partNumber - 1) * partSize;
        const end = Math.min(offset + partSize, file.size);
        const url = await lambdaClient.upload.createS3MultipartUploadPartUrl.mutate({
          partNumber,
          pathname,
          uploadId,
        });

        const etag = await this.putBlob(url, file.slice(offset, end), signal, (loaded) => {
          onProgress(offset + loaded);
        });
        if (etag) parts.push({ etag, partNumber });
        onProgress(end);
      }

      await lambdaClient.upload.completeS3MultipartUpload.mutate({
        partCount,
        parts: parts.length === partCount ? parts : undefined,
        pathname,
        uploadId,
      });
    } catch (error) {
      try {
        await lambdaClient.upload.abortS3MultipartUpload.mutate({ pathname, uploadId });
      } catch (abortError) {
        console.error('Failed to abort S3 multipart upload:', abortError);
      }
      throw error;
    }
  };
}

export const uploadService = new UploadService();
