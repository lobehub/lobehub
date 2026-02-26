import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
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
      (signal) =>
        fetch('https://api.search1api.com/crawl', {
          body: JSON.stringify({
            url,
          }),
          headers: {
            'Authorization': !apiKey ? '' : `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal,
        }),
      DEFAULT_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new PageNotFoundError(res.statusText);
    }

    throw await createHTTPStatusError(res, 'Search1API');
  }

  const data = await parseJSONResponse<Search1ApiResponse>(res, 'Search1API');

  // Check if content is empty or too short
  if (!data.results?.content || data.results.content.length < 100) {
    return;
  }

  return {
    content: data.results.content,
    contentType: 'text',
    description: data.results?.title,
    // Using title as description since API doesn't provide a separate description
    length: data.results.content.length,
    siteName: new URL(url).hostname,
    title: data.results?.title,
    url: data.results?.link || url,
  } satisfies CrawlSuccessResult;
};
