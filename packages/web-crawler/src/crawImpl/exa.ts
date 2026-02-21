import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../utils/errorType';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface ExaResults {
  author?: string;
  favicon?: string;
  id?: string;
  image?: string;
  publishedDate?: string;
  summary?: string;
  text: string;
  title: string;
  url: string;
}

interface ExaResponse {
  requestId?: string;
  results: ExaResults[];
}

export const exa: CrawlImpl = async (url) => {
  // Get API key from environment variable
  const apiKey = process.env.EXA_API_KEY;

  let res: Response;

  try {
    res = await withTimeout(
      fetch('https://api.exa.ai/contents', {
        body: JSON.stringify({
          livecrawl: 'fallback', // always, fallback
          text: true,
          urls: [url],
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': !apiKey ? '' : apiKey,
        },
        method: 'POST',
      }),
      DEFAULT_TIMEOUT,
    );
  } catch (e) {
    const error = e as Error;
    if (error.message === 'fetch failed') {
      throw new NetworkConnectionError();
    }

    if (error instanceof TimeoutError) {
      throw error;
    }

    throw e;
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new PageNotFoundError(res.statusText);
    }

    throw new Error(`Exa request failed with status ${res.status}: ${res.statusText}`);
  }

  try {
    const data = (await res.json()) as ExaResponse;

    if (!data.results || data.results.length === 0) {
      console.warn('Exa API returned no results for URL:', url);
      return;
    }

    const firstResult = data.results[0];

    // Check if content is empty or too short
    if (!firstResult.text || firstResult.text.length < 100) {
      return;
    }

    return {
      content: firstResult.text,
      contentType: 'text',
      length: firstResult.text.length,
      siteName: new URL(url).hostname,
      title: firstResult.title,
      url: firstResult.url || url,
    } satisfies CrawlSuccessResult;
  } catch (error) {
    console.error(error);
  }

  return;
};
