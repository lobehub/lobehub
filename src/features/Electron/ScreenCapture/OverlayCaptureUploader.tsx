'use client';

import {
  type OverlayCaptureUploadStatus,
  type OverlayUploadRequestPayload,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { COMPRESSIBLE_IMAGE_TYPES, compressImageFile } from '@lobechat/utils/compressImage';
import { memo, useCallback } from 'react';

import { useFileStore } from '@/store/file';
import type { UploadFileItem } from '@/types/files/upload';

import { overlayCaptureUploadPool } from './overlayCaptureUploadPool';

const reportStatus = (
  captureId: string,
  status: OverlayCaptureUploadStatus,
  fileId?: string,
): void => {
  void window.electronAPI?.invoke?.('screenCapture.reportUploadStatus', {
    captureId,
    fileId,
    status,
  });
};

/**
 * Listens for `overlayUploadRequest` broadcasts and runs the screenshot
 * through the full upload pipeline (hash dedup + S3) using a dedicated path
 * that bypasses `chatUploadFileList`. The resolved `UploadFileItem` is
 * stashed in `overlayCaptureUploadPool` so the follow-up dispatch can call
 * `sendMessage` without re-uploading, and without the screenshot bleeding
 * into the chat input's preview tray.
 */
const OverlayCaptureUploader = memo(() => {
  const handler = useCallback(async (payload: OverlayUploadRequestPayload) => {
    const { bytes, captureId, filename, mimeType } = payload;
    overlayCaptureUploadPool.ensureEntry(captureId);

    try {
      reportStatus(captureId, 'uploading');

      const initialFile = new File([bytes], filename, { type: mimeType });
      const file = COMPRESSIBLE_IMAGE_TYPES.has(initialFile.type)
        ? await compressImageFile(initialFile)
        : initialFile;

      const result = await useFileStore.getState().uploadWithProgress({ file });

      if (!result?.id) {
        reportStatus(captureId, 'failed');
        overlayCaptureUploadPool.resolve(captureId, null);
        return;
      }

      const item: UploadFileItem = {
        file,
        fileUrl: result.url,
        id: result.id,
        status: 'success',
      };

      reportStatus(captureId, 'ready', result.id);
      overlayCaptureUploadPool.resolve(captureId, item);
    } catch (error) {
      console.warn('[OverlayCaptureUploader] upload failed:', error);
      reportStatus(captureId, 'failed');
      overlayCaptureUploadPool.resolve(captureId, null);
    }
  }, []);

  useWatchBroadcast('overlayUploadRequest', handler);

  return null;
});

OverlayCaptureUploader.displayName = 'OverlayCaptureUploader';

export default OverlayCaptureUploader;
