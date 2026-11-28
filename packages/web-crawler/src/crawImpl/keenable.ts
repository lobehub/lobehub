import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

const KEENABLE_DEFAULT_BASE_URL = 'https://api.keenable.ai';

interface KeenableFetchPage {
  author?: string;
  content?: string;
  published_at?: string;
  title?: string;
  url?: string;
  error?: { status?: number; message?: string; error?: string };
}

interface KeenableFetchResponse {
  results?: KeenableFetchPage[];
}

/**
 * Keenable answers without an API key on its public tier (rate-limited per IP),
 * which requires the calling app to be named in `X-Keenable-Title`. Setting
 * `KEENABLE_API_KEY` switches to the keyed endpoint.
 *
 * @see https://api.keenable.ai/openapi.json
 */
export const keenable: CrawlImpl = async (url) => {
  const apiKey = process.env.KEENABLE_API_KEY;
  const baseUrl = (process.env.KEENABLE_API_URL || KEENABLE_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/fetch${apiKey ? '' : '/public'}`;

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(endpoint, {
          body: JSON.stringify({ urls: [url] }),
          headers: apiKey
            ? { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey }
            : { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Keenable-Title': 'LobeHub' },
          method: 'POST',
          signal,
        }),
      DEFAULT_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    // A whole-call 404 is unexpected on POST; keep the mapping anyway.
    if (res.status === 404) {
      throw new PageNotFoundError(res.statusText);
    }

    throw await createHTTPStatusError(res, 'Keenable');
  }

  const envelope = await parseJSONResponse<KeenableFetchResponse>(res, 'Keenable');
  const data = envelope.results?.[0];
  if (data?.error) {
    const status = data.error.status ?? 502;
    if (status === 404) {
      throw new PageNotFoundError(data.error.message || data.error.error || 'Not Found');
    }
    throw await createHTTPStatusError(
      new Response(JSON.stringify(data.error), {
        headers: { 'content-type': 'application/json' },
        status,
        statusText: data.error.error || 'Error',
      }),
      'Keenable',
    );
  }

  if (!data?.content || data.content.length < 100) {
    return;
  }

  return {
    content: data.content,
    contentType: 'text',
    length: data.content.length,
    siteName: new URL(url).hostname,
    title: data.title,
    url: data.url || url,
  } satisfies CrawlSuccessResult;
};
