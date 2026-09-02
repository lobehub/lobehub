'use client';

import type { DeviceScope } from '@lobechat/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { deviceService } from '@/services/device';

export interface RemoteWorkingDirectorySelection {
  path: string;
  repoType?: 'git' | 'github';
}

export type RemoteFolderSelectionError =
  'PATH_NOT_DIRECTORY' | 'PATH_NOT_FOUND' | 'SAVE_FAILED' | 'UNAVAILABLE';

interface UseRemoteFolderSelectionOptions {
  deviceId: string;
  onClose: () => void;
  onSelect: (entry: RemoteWorkingDirectorySelection) => Promise<void> | void;
  scope: DeviceScope;
}

export const useRemoteFolderSelection = ({
  deviceId,
  onClose,
  onSelect,
  scope,
}: UseRemoteFolderSelectionOptions) => {
  const mountedRef = useRef(true);
  const selectingRef = useRef(false);
  const [error, setError] = useState<RemoteFolderSelectionError>();
  const [saveRetryPath, setSaveRetryPath] = useState<string>();
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearError = useCallback(() => {
    setError(undefined);
    setSaveRetryPath(undefined);
  }, []);

  const confirmPath = useCallback(
    async (path: string) => {
      const candidate = path.trim();
      if (!candidate || selectingRef.current) return;

      selectingRef.current = true;
      setSaveRetryPath(undefined);
      setSelecting(true);
      setError(undefined);

      try {
        const result = await deviceService.statPath(deviceId, scope, candidate);
        // Closing the modal while the remote stat is in flight is a cancel,
        // never permission to persist the path after this hook unmounts.
        if (!mountedRef.current) return;
        if (!result) {
          setError('UNAVAILABLE');
          return;
        }
        if (!result.exists) {
          setError('PATH_NOT_FOUND');
          return;
        }
        if (!result.isDirectory) {
          setError('PATH_NOT_DIRECTORY');
          return;
        }

        const normalizedPath = result.path?.trim();
        if (!normalizedPath) {
          setError('UNAVAILABLE');
          return;
        }

        try {
          await onSelect({ path: normalizedPath, repoType: result.repoType });
        } catch {
          if (mountedRef.current) {
            setSaveRetryPath(normalizedPath);
            setError('SAVE_FAILED');
          }
          return;
        }
        if (mountedRef.current) onClose();
      } catch {
        if (mountedRef.current) setError('UNAVAILABLE');
      } finally {
        selectingRef.current = false;
        if (mountedRef.current) setSelecting(false);
      }
    },
    [deviceId, onClose, onSelect, scope],
  );

  const retrySave = useCallback(async () => {
    if (saveRetryPath) await confirmPath(saveRetryPath);
  }, [confirmPath, saveRetryPath]);

  return { clearError, confirmPath, error, retrySave, selecting };
};
