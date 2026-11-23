import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

/**
 * Fixed endpoint of the AI/ML API Toolbox. The API key is only ever sent to this host;
 * redirects are rejected so the key cannot follow a `Location` to another origin.
 */
export const AIMLAPI_TOOLS_RUN_URL = 'https://tools.aimlapi.com/v1/tools/run';

interface AimlApiContentsResult {
  text?: string;
  title?: string;
  url?: string;
}

interface AimlApiToolRunResponse {
  error?: { message?: string };
  is_error?: boolean;
  output?: { results?: AimlApiContentsResult[] };
  status?: string;
}

/**
 * URL for logs: origin and path only. Query and fragment may carry signatures or tokens
 * (presigned storage links), so they never reach the server logs.
 */
const redactUrl = (url: string): string => {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return '[invalid url]';
  }
};

export const aimlapi: CrawlImpl = async (url) => {
  const apiKey = process.env.AIMLAPI_API_KEY;

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(AIMLAPI_TOOLS_RUN_URL, {
          body: JSON.stringify({ input: { text: true, urls: [url] }, tool: 'exa/contents' }),
          headers: {
            'Authorization': !apiKey ? '' : `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          redirect: 'error',
          signal,
        }),
      DEFAULT_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    throw await createHTTPStatusError(res, 'AI/ML API');
  }

  const data = await parseJSONResponse<AimlApiToolRunResponse>(res, 'AI/ML API');

  if (data.is_error || (data.status && data.status !== 'completed')) {
    console.warn(
      'AI/ML API page read failed for URL:',
      redactUrl(url),
      data.error?.message || data.status,
    );
    return;
  }

  const result = data.output?.results?.[0];

  // Check if content is empty or too short
  if (!result?.text || result.text.length < 100) {
    return;
  }

  return {
    content: result.text,
    contentType: 'text',
    length: result.text.length,
    siteName: new URL(url).hostname,
    title: result.title || new URL(url).hostname,
    url: result.url || url,
  } satisfies CrawlSuccessResult;
};
