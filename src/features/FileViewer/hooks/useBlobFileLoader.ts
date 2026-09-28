import { readBlobWithLimit } from '@lobechat/utils/readBlobWithLimit';
import { useEffect, useState } from 'react';

/** Mirrors the device-side document preview ceiling in `@lobechat/device-control`. */
const MAX_BINARY_PREVIEW_BYTES = 20 * 1024 * 1024;

interface BlobFileState {
  blob: Blob | null;
  error: Error | null;
  loading: boolean;
  tooLarge?: boolean;
  url: string | null;
}

/**
 * Download original file bytes for a bounded, read-only binary preview.
 *
 * Use when:
 * - Rendering an office document with an in-app renderer that takes a blob.
 *
 * Expects:
 * - An accessible file URL; null disables the request.
 *
 * Returns:
 * - A blob, loading/error state, or `tooLarge` for oversized files.
 */
export const useBlobFileLoader = (url: string | null): BlobFileState => {
  const [state, setState] = useState<BlobFileState>({
    blob: null,
    error: null,
    loading: !!url,
    url,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ blob: null, error: null, loading: !!url, url });
    if (!url) return;

    const loadFile = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to load file: ${response.status}`);
        const blob = await readBlobWithLimit(response, MAX_BINARY_PREVIEW_BYTES);
        if (!controller.signal.aborted) setState({ blob, error: null, loading: false, url });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setState({
          blob: null,
          error:
            cause instanceof RangeError
              ? null
              : cause instanceof Error
                ? cause
                : new Error('Failed to load file'),
          loading: false,
          tooLarge: cause instanceof RangeError,
          url,
        });
      }
    };

    void loadFile();
    return () => controller.abort();
  }, [url]);

  // Never hand back a previous file's blob while the new URL's effect is starting.
  return state.url === url ? state : { blob: null, error: null, loading: !!url, url };
};
