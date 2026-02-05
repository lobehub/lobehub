import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../utils/errorType';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface TavilyResults {
  images?: string[];
  raw_content: string;
  url: string;
}

interface TavilyFailedResults {
  error?: string;
  url: string;
}

interface TavilyResponse {
  base_url: string;
  failed_results?: TavilyFailedResults[];
  response_time: number;
  results: TavilyResults[];
}

export const tavily: CrawlImpl = async (url) => {
  // Get API key from environment variable
  const apiKey = process.env.TAVILY_API_KEY;

  let res: Response;

  try {
    res = await withTimeout(
      fetch('https://api.tavily.com/extract', {
        body: JSON.stringify({
          extract_depth: process.env.TAVILY_EXTRACT_DEPTH || 'basic', // basic or advanced
          include_images: false,
          urls: url,
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

    throw new Error(`Tavily request failed with status ${res.status}: ${res.statusText}`);
  }

  try {
    const data = (await res.json()) as TavilyResponse;

    if (!data.results || data.results.length === 0) {
      console.warn('Tavily API returned no results for URL:', url);
      return;
    }

    const firstResult = data.results[0];

    // Check if content is empty or too short
    if (!firstResult.raw_content || firstResult.raw_content.length < 100) {
      return;
    }

    return {
      content: firstResult.raw_content,
      contentType: 'text',
      length: firstResult.raw_content.length,
      siteName: new URL(url).hostname,
      title: new URL(url).hostname,
      url: firstResult.url || url,
    } satisfies CrawlSuccessResult;
  } catch (error) {
    console.error(error);
  }

  return;
};
