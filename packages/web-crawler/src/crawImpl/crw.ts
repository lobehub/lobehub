import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

// fastCRW is a Firecrawl-compatible web scraper (single binary; self-host or cloud).
// This impl mirrors the Firecrawl crawler, swapping the base URL and env vars.

interface CrwMetadata {
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

interface CrwResults {
  html?: string;
  links?: string[];
  markdown?: string;
  metadata: CrwMetadata;
  rawHtml?: string;
  screenshot?: string;
  summary?: string;
  warning?: string;
}

interface CrwResponse {
  data: CrwResults;
  success: boolean;
}

export const crw: CrawlImpl = async (url) => {
  // Get API key from environment variable
  const apiKey = process.env.CRW_API_KEY;
  // Default to the managed cloud; allow overriding the base URL for self-host.
  const baseUrl = process.env.CRW_URL || 'https://fastcrw.com/api';

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(`${baseUrl}/v1/scrape`, {
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

    throw await createHTTPStatusError(res, 'fastCRW');
  }

  const data = await parseJSONResponse<CrwResponse>(res, 'fastCRW');
  if (!data.data) {
    throw new Error('fastCRW response missing data field');
  }

  if (data.data.warning) {
    console.warn('[fastCRW] Warning:', data.data.warning);
  }

  if (data.data.metadata.error) {
    console.error('[fastCRW] Metadata error:', data.data.metadata.error);
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
