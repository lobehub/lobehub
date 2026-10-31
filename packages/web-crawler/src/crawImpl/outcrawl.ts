import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface OutcrawlMetadata {
  contentType?: string;
  description?: string;
  language?: string;
  title?: string;
}

interface OutcrawlScrapeResponse {
  markdown?: string;
  metadata?: OutcrawlMetadata;
  statusCode?: number;
  url?: string;
}

export const outcrawl: CrawlImpl = async (url) => {
  // Get API key from environment variable
  const apiKey = process.env.OUTCRAWL_API_KEY;
  const baseUrl = process.env.OUTCRAWL_URL || 'https://api.outcrawl.ai/v1';

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(`${baseUrl}/scrape`, {
          body: JSON.stringify({
            formats: ['markdown'],
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

    throw await createHTTPStatusError(res, 'Outcrawl');
  }

  const data = await parseJSONResponse<OutcrawlScrapeResponse>(res, 'Outcrawl');

  // Outcrawl answers 200 and reports the target page's own status in `statusCode`
  if (data.statusCode === 404) {
    throw new PageNotFoundError('Not Found');
  }

  // Check if content is empty or too short
  if (!data.markdown || data.markdown.length < 100) {
    return;
  }

  return {
    content: data.markdown,
    contentType: 'text',
    description: data.metadata?.description || '',
    length: data.markdown.length,
    siteName: new URL(url).hostname,
    title: data.metadata?.title || '',
    url,
  } satisfies CrawlSuccessResult;
};
