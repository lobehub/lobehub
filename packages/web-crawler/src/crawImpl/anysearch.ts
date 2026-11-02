import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { HTTPStatusError, PageNotFoundError, toFetchError } from '../utils/errorType';
import { parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface AnySearchExtractResponse {
  code: number;
  data?: {
    content?: string;
    title?: string;
    url?: string;
  };
  message?: string;
  request_id?: string;
}

export const anysearch: CrawlImpl = async (url) => {
  const apiKey = process.env.ANYSEARCH_API_KEY?.trim();
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await withTimeout(
      (signal) =>
        fetch('https://api.anysearch.com/v1/extract', {
          body: JSON.stringify({ url }),
          headers,
          method: 'POST',
          signal,
        }),
      DEFAULT_TIMEOUT,
    );
  } catch (error) {
    throw toFetchError(error);
  }

  if (!response.ok) {
    if (response.status === 404 || response.status === 410) {
      throw new PageNotFoundError(response.statusText, response.status);
    }

    // Do not include AnySearch error bodies here. Anonymous-quota responses can
    // contain account/bootstrap data that must not reach crawler logs or tool output.
    throw new HTTPStatusError(
      `AnySearch request failed with status ${response.status}: ${response.statusText}`,
      response.status,
    );
  }

  const payload = await parseJSONResponse<AnySearchExtractResponse>(response, 'AnySearch');
  if (payload.code !== 0 || !payload.data) {
    throw new Error(
      payload.message ? `AnySearch extract failed: ${payload.message}` : 'AnySearch extract failed',
    );
  }

  const content = payload.data.content?.trim();
  if (!content) return;

  const resultUrl = payload.data.url || url;
  return {
    content,
    contentType: 'text',
    description: payload.data.title,
    length: content.length,
    siteName: new URL(resultUrl).hostname,
    title: payload.data.title,
    url: resultUrl,
  } satisfies CrawlSuccessResult;
};
