import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import { parseDataUri } from '@lobechat/model-runtime/utils/uriParser';
import { uuid } from '@lobechat/utils';
import dayjs from 'dayjs';

import { fileEnv } from '@/envs/file';
import { lambdaClient } from '@/libs/trpc/client';
import type { FileMetadata, UploadBase64ToS3Result } from '@/types/files';
import type { FileUploadState, FileUploadStatus } from '@/types/files/upload';

import { hashFile } from './hashFile';

export const UPLOAD_NETWORK_ERROR = 'NetWorkError';

const MAX_MULTIPART_PARTS = 10_000;
const MULTIPART_PART_SIZE = 32 * 1024 * 1024;
const MULTIPART_UPLOAD_THRESHOLD = 64 * 1024 * 1024;

const MAX_PART_RETRIES = 3;
const PART_RETRY_BASE_DELAY_MS = 1000;
/** A PUT fails when the browser reports no upload progress for this long. */
const PUT_STALL_TIMEOUT_MS = 120_000;
/**
 * `xhr.timeout` covers the whole request, so it scales with the body: a fixed
 * value would permanently fail a slow connection that is still making progress.
 */
const PUT_MIN_TIMEOUT_MS = 120_000;
const PUT_MIN_BYTES_PER_SECOND = 32 * 1024;
const SIGN_PART_TIMEOUT_MS = 60_000;
const COMPLETE_MULTIPART_TIMEOUT_MS = 5 * 60_000;
const CLEANUP_TIMEOUT_MS = 30_000;

const FAILED_UPLOAD_STATE: FileUploadState = { progress: 0, restTime: 0, speed: 0 };

const getAbortReason = (signal: AbortSignal) =>
  signal.reason ?? new Error('Upload cancelled by user');

/**
 * Settle with `task`, or reject once `timeoutMs` passes or `signal` aborts. A
 * hung API call must not hold the upload in `uploading`.
 */
const withDeadline = <T>(task: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(getAbortReason(signal!));
    const timer = setTimeout(() => reject(UPLOAD_NETWORK_ERROR), timeoutMs);
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    task.then(resolve, reject).finally(settle);
  });

const waitForRetry = (delayMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(getAbortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** The API answered that this part is not allowed, which a new attempt cannot change. */
const isRejectedByApi = (error: unknown): boolean => {
  const httpStatus = (error as { data?: { httpStatus?: unknown } } | undefined)?.data?.httpStatus;
  return (
    typeof httpStatus === 'number' &&
    httpStatus >= 400 &&
    httpStatus < 500 &&
    httpStatus !== 408 &&
    httpStatus !== 429
  );
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
  releaseUpload = async (pathname: string) => {
    try {
      await withDeadline(
        lambdaClient.upload.abortS3Upload.mutate({ pathname }),
        CLEANUP_TIMEOUT_MS,
      );
    } catch (error) {
      console.error('Failed to clean S3 upload:', error);
    }
  };

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

    const hash = await hashFile(file, options.abortController?.signal);

    // Use unified upload method
    const { data: metadata } = await this.uploadFileToS3(file, options);

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
      await this.releaseUpload(uploadPathname);
      onProgress?.(abortController?.signal.aborted ? 'cancelled' : 'error', FAILED_UPLOAD_STATE);
      throw error;
    }

    onProgress?.('success', {
      progress: 100,
      restTime: 0,
      speed: file.size / Math.max((Date.now() - startTime) / 1000, 0.001),
    });

    return result;
  };

  /**
   * PUT a file to a pre-signed URL someone else minted (the agent-share
   * visitor path: `shareChat.createUploadUrl` reserves the key under the
   * CREATOR's quota and hands back the URL). Single PUT only — callers cap the
   * size below the multipart threshold. Reports progress in the same
   * `FileUploadState` shape as {@link uploadToServerS3}; abort/cleanup of the
   * reservation is the caller's job since only it knows which endpoint to hit.
   */
  uploadToPresignedUrl = async (
    file: File,
    url: string,
    {
      abortController,
      onProgress,
    }: {
      abortController?: AbortController;
      onProgress?: (status: FileUploadStatus, state: FileUploadState) => void;
    } = {},
  ): Promise<void> => {
    const startTime = Date.now();

    try {
      await this.putBlob(
        url,
        file,
        abortController?.signal,
        (loaded) => {
          onProgress?.('uploading', this.getUploadState(loaded, file.size, startTime));
        },
        file.type,
      );
    } catch (error) {
      onProgress?.(abortController?.signal.aborted ? 'cancelled' : 'error', FAILED_UPLOAD_STATE);
      throw error;
    }

    onProgress?.('success', {
      progress: 100,
      restTime: 0,
      speed: file.size / Math.max((Date.now() - startTime) / 1000, 0.001),
    });
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
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await new Promise<string | undefined>((resolve, reject) => {
        const armStallTimer = () => {
          clearTimeout(stallTimer);
          stallTimer = setTimeout(() => {
            reject(UPLOAD_NETWORK_ERROR);
            xhr.abort();
          }, PUT_STALL_TIMEOUT_MS);
        };

        xhr.upload.addEventListener('progress', (event) => {
          armStallTimer();
          if (event.lengthComputable) onProgress(event.loaded);
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.getResponseHeader?.('ETag') || undefined);
          } else reject(xhr.statusText || `HTTP ${xhr.status}`);
        });
        xhr.addEventListener('error', () => {
          if (xhr.status === 0) reject(UPLOAD_NETWORK_ERROR);
          else reject(xhr.statusText || `HTTP ${xhr.status}`);
        });
        xhr.addEventListener('timeout', () => reject(UPLOAD_NETWORK_ERROR));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled by user')));
        xhr.open('PUT', url);
        xhr.timeout = Math.max(PUT_MIN_TIMEOUT_MS, (blob.size / PUT_MIN_BYTES_PER_SECOND) * 1000);
        if (contentType) xhr.setRequestHeader('Content-Type', contentType);
        xhr.send(blob);
        armStallTimer();
      });
    } finally {
      clearTimeout(stallTimer);
      signal?.removeEventListener('abort', abort);
    }
  };

  /**
   * Every attempt signs a new URL: a pre-signed URL may have expired by the time
   * the previous attempt failed. Cancelling never retries.
   */
  private uploadPartWithRetry = async (
    blob: Blob,
    part: { partNumber: number; pathname: string; uploadId: string },
    signal: AbortSignal | undefined,
    onProgress: (loaded: number) => void,
  ): Promise<string | undefined> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const url = await withDeadline(
          lambdaClient.upload.createS3MultipartUploadPartUrl.mutate(part),
          SIGN_PART_TIMEOUT_MS,
          signal,
        );

        return await this.putBlob(url, blob, signal, onProgress);
      } catch (error) {
        if (signal?.aborted || attempt >= MAX_PART_RETRIES || isRejectedByApi(error)) throw error;

        console.warn(
          `Retrying part ${part.partNumber} of upload ${part.uploadId} (attempt ${attempt + 2}):`,
          error,
        );
        await waitForRetry(PART_RETRY_BASE_DELAY_MS * 2 ** attempt, signal);
      }
    }
  };

  private uploadMultipart = async (
    file: File,
    pathname: string,
    signal: AbortSignal | undefined,
    onProgress: (loaded: number) => void,
  ): Promise<void> => {
    const parts: Array<{ etag: string; partNumber: number }> = [];
    const upload = await lambdaClient.upload.createS3MultipartUpload.mutate({
      contentType: file.type || undefined,
      pathname,
      size: file.size,
    });
    const partSize =
      upload.partSize ?? Math.max(MULTIPART_PART_SIZE, Math.ceil(file.size / MAX_MULTIPART_PARTS));
    const partCount = Math.ceil(file.size / partSize);
    const { uploadId } = upload;

    try {
      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        if (signal?.aborted) throw signal.reason ?? new Error('Upload cancelled by user');

        const offset = (partNumber - 1) * partSize;
        const end = Math.min(offset + partSize, file.size);
        const etag = await this.uploadPartWithRetry(
          file.slice(offset, end),
          { partNumber, pathname, uploadId },
          signal,
          (loaded) => {
            onProgress(offset + loaded);
          },
        );
        if (etag) parts.push({ etag, partNumber });
        onProgress(end);
      }

      await withDeadline(
        lambdaClient.upload.completeS3MultipartUpload.mutate({
          partCount,
          parts: parts.length === partCount ? parts : undefined,
          pathname,
          uploadId,
        }),
        COMPLETE_MULTIPART_TIMEOUT_MS,
        signal,
      );
    } catch (error) {
      try {
        await withDeadline(
          lambdaClient.upload.abortS3MultipartUpload.mutate({ pathname, uploadId }),
          CLEANUP_TIMEOUT_MS,
        );
      } catch (abortError) {
        console.error('Failed to abort S3 multipart upload:', abortError);
      }
      throw error;
    }
  };
}

export const uploadService = new UploadService();
