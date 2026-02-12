import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../utils/errorType';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface Search1ApiResponse {
  crawlParameters: {
    url: string;
  };
  results: {
    content?: string;
    link?: string;
    title?: string;
  };
}

export const search1api: CrawlImpl = async (url) => {
  // Get API key from environment variable
  const apiKey = process.env.SEARCH1API_CRAWL_API_KEY || process.env.SEARCH1API_API_KEY;

  let res: Response;

  try {
    res = await withTimeout(
      fetch('https://api.search1api.com/crawl', {
        body: JSON.stringify({
          url,
        }),
        headers: {
          'Authorization': !apiKey ? '' : `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
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

    throw new Error(`Search1API request failed with status ${res.status}: ${res.statusText}`);
  }

  try {
    const data = (await res.json()) as Search1ApiResponse;

    // Check if content is empty or too short
    if (!data.results.content || data.results.content.length < 100) {
      return;
    }

    return {
      content: data.results.content,
      contentType: 'text',
      description: data.results.title,
      // Using title as description since API doesn't provide a separate description
      length: data.results.content.length,
      siteName: new URL(url).hostname,
      title: data.results.title,
      url: data.results.link || url,
    } satisfies CrawlSuccessResult;
  } catch (error) {
    console.error(error);
  }

  return;
};
