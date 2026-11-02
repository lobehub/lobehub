import { useCallback, useEffect, useRef, useState } from 'react';

import { localFileService } from '@/services/electron/localFileService';

export type LocalVideoState =
  | { status: 'loading' }
  | { src: string; status: 'ready' }
  | { oversized: boolean; status: 'unplayable' };

interface UseLocalVideoParams {
  allowExternalFile?: boolean;
  filePath: string;
  /** Changes when the file at `filePath` is replaced; triggers a re-read. */
  revision: string;
  workingDirectory: string;
}

/**
 * Reads a local video for playback outside the session-long SWR preview cache,
 * so its bytes (up to 200 MB) live only while they are in use: unmounting or a
 * new revision aborts an in-flight read and revokes the previous object URL,
 * and `markUnplayable` releases a blob Chromium could not decode.
 */
export const useLocalVideo = ({
  allowExternalFile,
  filePath,
  revision,
  workingDirectory,
}: UseLocalVideoParams) => {
  const [state, setState] = useState<LocalVideoState>({ status: 'loading' });
  const objectUrlRef = useRef<string>(undefined);

  const releaseObjectUrl = useCallback(() => {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = undefined;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    localFileService
      .readLocalVideo({ allowExternalFile, path: filePath, workingDirectory }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setState({ oversized: true, status: 'unplayable' });
          return;
        }
        const src = URL.createObjectURL(result.blob);
        objectUrlRef.current = src;
        setState({ src, status: 'ready' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ oversized: false, status: 'unplayable' });
      });

    return () => {
      controller.abort();
      releaseObjectUrl();
    };
  }, [allowExternalFile, filePath, releaseObjectUrl, revision, workingDirectory]);

  const markUnplayable = useCallback(() => {
    releaseObjectUrl();
    setState({ oversized: false, status: 'unplayable' });
  }, [releaseObjectUrl]);

  return { markUnplayable, state };
};
