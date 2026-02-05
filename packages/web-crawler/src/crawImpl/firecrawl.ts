import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../utils/errorType';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface FirecrawlMetadata {
  description?: string;
  error?: string;
  keywords?: string;
  language?: string;
  ogDescription?: string;
  ogImage?: string;
  ogLocaleAlternate?: string[];
  ogSiteName?: string;
  ogTitle?: string;
  ogUrl?: string;
  robots?: string;
  sourceURL: string;
  statusCode: number;
  title?: string;
}

interface FirecrawlResults {
  actions?: {
    javascriptReturns?: Array<{ type: string; value: any }>;
    pdfs?: string[];
    scrapes?: Array<{ html: string; url: string }>;
    screenshots?: string[];
  };
  changeTracking?: {
    changeStatus?: string;
    diff?: string;
    json?: Record<string, any>;
    previousScrapeAt?: string;
    visibility?: string;
  };
  html?: string;
  links?: string[];
  markdown?: string;
  metadata: FirecrawlMetadata;
  rawHtml?: string;
  screenshot?: string;
  summary?: string;
  warning?: string;
}

interface FirecrawlResponse {
  data: FirecrawlResults;
  success: boolean;
}

export const firecrawl: CrawlImpl = async (url) => {
  // Get API key from environment variable
  const apiKey = process.env.FIRECRAWL_API_KEY;
  const baseUrl = process.env.FIRECRAWL_URL || 'https://api.firecrawl.dev/v2';

  let res: Response;

  try {
    res = await withTimeout(
      fetch(`${baseUrl}/scrape`, {
        body: JSON.stringify({
          formats: ['markdown'], // ["markdown", "html"]
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

    throw new Error(`Firecrawl request failed with status ${res.status}: ${res.statusText}`);
  }

  try {
    const data = (await res.json()) as FirecrawlResponse;

    if (data.data.warning) {
      console.warn('[Firecrawl] Warning:', data.data.warning);
    }

    if (data.data.metadata.error) {
      console.error('[Firecrawl] Metadata error:', data.data.metadata.error);
    }

    // Check if content is empty or too short
    if (!data.data.markdown || data.data.markdown.length < 100) {
      return;
    }

    return {
      content: data.data.markdown,
      contentType: 'text',
      description: data.data.metadata.description || '',
      length: data.data.markdown.length,
      siteName: new URL(url).hostname,
      title: data.data.metadata.title || '',
      url: url,
    } satisfies CrawlSuccessResult;
  } catch (error) {
    console.error('[Firecrawl] Parse error:', error);
  }

  return;
};
