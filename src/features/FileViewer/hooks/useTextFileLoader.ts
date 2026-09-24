import { decodeTextBuffer } from '@lobechat/utils/isBinaryContent';
import { readBlobWithLimit } from '@lobechat/utils/readBlobWithLimit';
import { useEffect, useState } from 'react';

/** Bound text downloads and decoding to 2 MiB to keep preview rendering responsive. */
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

interface TextFileState {
  error: Error | null;
  fileData: string | null;
  loading: boolean;
  tooLarge?: boolean;
  url: string | null;
}

/**
 * Load original file bytes for a bounded, read-only text preview.
 *
 * Use when:
 * - Rendering text or attempting a text fallback for an unknown file format.
 *
 * Expects:
 * - An accessible file URL; null disables the request.
 *
 * Returns:
 * - Text, loading/error state, or null content for binary and oversized files.
 */
export const useTextFileLoader = (url: string | null): TextFileState => {
  const [state, setState] = useState<TextFileState>({
    error: null,
    fileData: null,
    loading: !!url,
    url,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ error: null, fileData: null, loading: !!url, url });
    if (!url) return;

    const loadFile = async () => {
      try {
        // Abort on navigation; enforce the limit even when Content-Length is missing or wrong.
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to load file: ${response.status}`);
        const blob = await readBlobWithLimit(response, MAX_TEXT_PREVIEW_BYTES);
        const fileData = decodeTextBuffer(new Uint8Array(await blob.arrayBuffer()));
        if (!controller.signal.aborted) setState({ error: null, fileData, loading: false, url });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setState({
          error:
            cause instanceof RangeError
              ? null
              : cause instanceof Error
                ? cause
                : new Error('Failed to load file'),
          fileData: null,
          loading: false,
          tooLarge: cause instanceof RangeError,
          url,
        });
      }
    };

    void loadFile();
    return () => controller.abort();
  }, [url]);

  // Never flash a previous file's content while the new URL's effect is starting.
  return state.url === url ? state : { error: null, fileData: null, loading: !!url, url };
};
