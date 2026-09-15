import { SHARE_VISITOR_MAX_FILE_SIZE } from '@lobechat/const';

import { hashFile } from '@/services/hashFile';
import { shareChatService } from '@/services/shareChat';
import { uploadService } from '@/services/upload';
import type { UploadFileItem } from '@/types/files';
import { getAudioDuration } from '@/utils/client/audioDuration';
import { getImageDimensions } from '@/utils/client/imageDimensions';

import { normalizeUploadedFileType } from '../upload/action';
import { audioMimeFromExtension } from './uploadGuard';

type OnStatusUpdate = (data: {
  id: string;
  type: 'updateFile';
  value: Partial<UploadFileItem>;
}) => void;

export const SHARE_UPLOAD_STORAGE_BLOCK_PREFIX = 'storage_block:';

/** The creator's storage quota refused the bytes (`shareChat.createUploadUrl`). */
export const isShareStorageBlockError = (error: unknown) =>
  error instanceof Error && error.message.startsWith(SHARE_UPLOAD_STORAGE_BLOCK_PREFIX);

export const isShareFileTooLarge = (file: File) => file.size > SHARE_VISITOR_MAX_FILE_SIZE;

/**
 * Upload one chat attachment as an agent-share VISITOR.
 *
 * The share counterpart of `uploadWithProgress`: same client-side prep
 * (type sniffing, image dimensions, audio duration, content hash) so the
 * attachment renders exactly like an owner upload, but the storage
 * reservation, the file row and any cleanup go through the share-scoped
 * endpoints — the file lands under the CREATOR's account and quota, which the
 * visitor's own `upload.*` / `file.*` procedures could never write to.
 *
 * Deliberately no hash dedup against `checkFileHash`: that lookup is the
 * visitor's own global-file view, and a share file must always be a fresh
 * creator-owned row with share provenance.
 */
export const uploadShareVisitorFile = async ({
  abortController,
  file,
  onStatusUpdate,
  shareId,
}: {
  abortController?: AbortController;
  file: File;
  onStatusUpdate?: OnStatusUpdate;
  shareId: string;
}): Promise<{ id: string; url: string }> => {
  const statusId = file.name;
  const { detectedMimeType, file: normalizedFile } = await normalizeUploadedFileType(file);
  const extensionAudioMime = audioMimeFromExtension(normalizedFile.name);

  let fileType = normalizedFile.type || detectedMimeType || 'text/plain';
  if (extensionAudioMime && !fileType.startsWith('audio/')) fileType = extensionAudioMime;

  const [dimensions, durationMs, hash] = await Promise.all([
    getImageDimensions(normalizedFile),
    fileType.startsWith('audio/')
      ? getAudioDuration(normalizedFile).catch(() => undefined)
      : undefined,
    hashFile(normalizedFile, abortController?.signal, (progress) => {
      onStatusUpdate?.({
        id: statusId,
        type: 'updateFile',
        value: { status: 'pending', uploadState: { progress, restTime: 0, speed: 0 } },
      });
    }),
  ]);

  const { pathname, url } = await shareChatService.createUploadUrl(shareId, {
    name: normalizedFile.name,
    size: normalizedFile.size,
  });

  try {
    await uploadService.uploadToPresignedUrl(normalizedFile, url, {
      abortController,
      onProgress: (status, uploadState) => {
        onStatusUpdate?.({
          id: statusId,
          type: 'updateFile',
          value: { status: status === 'success' ? 'processing' : status, uploadState },
        });
      },
    });

    const data = await shareChatService.createFile({
      fileType,
      hash,
      metadata: {
        ...dimensions,
        ...(durationMs === undefined ? {} : { durationMs }),
      },
      name: normalizedFile.name,
      pathname,
      shareId,
      size: normalizedFile.size,
    });

    onStatusUpdate?.({
      id: statusId,
      type: 'updateFile',
      value: {
        ...(dimensions && { dimensions }),
        fileUrl: data.url,
        id: data.id,
        status: 'success',
        uploadState: { progress: 100, restTime: 0, speed: 0 },
      },
    });

    return data;
  } catch (error) {
    await shareChatService.abortUpload(shareId, pathname);
    throw error;
  }
};
