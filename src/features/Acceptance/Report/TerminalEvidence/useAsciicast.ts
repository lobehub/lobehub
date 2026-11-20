import { readBlobWithLimit } from '@lobechat/utils/readBlobWithLimit';
import {
  type Asciicast,
  ASCIICAST_LIMITS,
  AsciicastError,
  parseAsciicast,
} from '@lobechat/utils/verify/asciicast';
import { useEffect, useState } from 'react';

export type AsciicastLoadError =
  { kind: 'failed' } | { kind: 'invalid'; message: string } | { kind: 'tooLarge' };

interface AsciicastState {
  cast: Asciicast | null;
  error: AsciicastLoadError | null;
  loading: boolean;
  url: string | null;
}

type LoadResult = { cast: Asciicast } | { error: AsciicastLoadError };

/**
 * The replay and the "output from recording" view read the same file; one
 * in-flight / settled load per URL keeps switching between them from
 * downloading it twice. Small on purpose — a parsed recording can be large.
 */
const cache = new Map<string, Promise<LoadResult>>();
const CACHE_SIZE = 2;

const load = (url: string): Promise<LoadResult> => {
  const cached = cache.get(url);
  if (cached) return cached;

  const promise = (async (): Promise<LoadResult> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return { error: { kind: 'failed' } };
      // Cancels the download past the limit, whether or not Content-Length says so.
      const blob = await readBlobWithLimit(response, ASCIICAST_LIMITS.maxBytes);
      const text = new TextDecoder('utf-8').decode(await blob.arrayBuffer());
      return { cast: parseAsciicast(text) };
    } catch (error) {
      if (error instanceof RangeError) return { error: { kind: 'tooLarge' } };
      if (error instanceof AsciicastError)
        return { error: { kind: 'invalid', message: error.message } };
      return { error: { kind: 'failed' } };
    }
  })();

  cache.set(url, promise);
  // A failed load is not cached: the next attempt (a retry, a reopened card) refetches.
  void promise.then((result) => {
    if ('error' in result && result.error.kind === 'failed') cache.delete(url);
  });
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return promise;
};

/** Fetch, bound and validate an asciicast recording. `null` disables the request. */
export const useAsciicast = (url: string | null): AsciicastState => {
  const [state, setState] = useState<AsciicastState>({
    cast: null,
    error: null,
    loading: !!url,
    url,
  });

  useEffect(() => {
    let active = true;
    setState({ cast: null, error: null, loading: !!url, url });
    if (!url) return;
    void load(url).then((result) => {
      if (!active) return;
      setState(
        'cast' in result
          ? { cast: result.cast, error: null, loading: false, url }
          : { cast: null, error: result.error, loading: false, url },
      );
    });
    return () => {
      active = false;
    };
  }, [url]);

  return state.url === url ? state : { cast: null, error: null, loading: !!url, url };
};
