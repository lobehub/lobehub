import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
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
      (signal) =>
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

    throw await createHTTPStatusError(res, 'Firecrawl');
  }

  const data = await parseJSONResponse<FirecrawlResponse>(res, 'Firecrawl');
  if (!data.data) {
    throw new Error('Firecrawl response missing data field');
  }

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
    url,
  } satisfies CrawlSuccessResult;
};
