import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface SpecStreamExtractedPage {
  /**
   * `ok`, `blocked`, `not_found`, `empty`, `unsupported`, `invalid_url` or `failed`
   */
  status: string;
  text?: string;
  title?: string;
  url: string;
}

interface SpecStreamExtractResponse {
  data?: {
    results?: SpecStreamExtractedPage[];
  };
}

/**
 * SpecStream gives each page up to 30s and retries a refused page through more readers,
 * so the shared 10s default would cut off pages it returns. Keep a larger `CRAWLER_TIMEOUT`
 * when one is configured.
 */
const SPECSTREAM_TIMEOUT = Math.max(DEFAULT_TIMEOUT, 35_000);

export const specstream: CrawlImpl = async (url) => {
  const apiKey = process.env.SPECSTREAM_API_KEY;

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch('https://api.specstream.ai/v1/extract', {
          body: JSON.stringify({ format: 'markdown', urls: [url] }),
          headers: {
            'Authorization': !apiKey ? '' : `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal,
        }),
      SPECSTREAM_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    throw await createHTTPStatusError(res, 'SpecStream');
  }

  const payload = await parseJSONResponse<SpecStreamExtractResponse>(res, 'SpecStream');
  const page = payload.data?.results?.[0];

  if (!page) return;

  if (page.status === 'not_found') {
    throw new PageNotFoundError('Not Found');
  }

  // Any other status without text (blocked, empty, unsupported, failed) lets the next crawler try
  if (page.status !== 'ok' || !page.text || page.text.length < 100) {
    return;
  }

  return {
    content: page.text,
    contentType: 'text',
    length: page.text.length,
    siteName: new URL(url).hostname,
    title: page.title || '',
    url,
  } satisfies CrawlSuccessResult;
};
