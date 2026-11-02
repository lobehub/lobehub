import urlJoin from 'url-join';

import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface DeepSeekFetchResponse {
  content?: string;
  title?: string;
}

export const deepseek: CrawlImpl = async (url) => {
  const apiKey = process.env.DEEPSEEK_SEARCH_API_KEY;
  const baseUrl = process.env.DEEPSEEK_SEARCH_API_URL || 'https://api.deepseek.com';
  const endpoint = urlJoin(baseUrl, '/v1/tools/fetch');

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(endpoint, {
          body: JSON.stringify({ url }),
          headers: {
            'Authorization': apiKey ? `Bearer ${apiKey}` : '',
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

    throw await createHTTPStatusError(res, 'DeepSeek');
  }

  const data = await parseJSONResponse<DeepSeekFetchResponse>(res, 'DeepSeek');

  if (!data?.content || data.content.trim().length === 0) {
    return;
  }

  const hostname = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();

  return {
    content: data.content,
    contentType: 'text',
    length: data.content.length,
    siteName: hostname,
    title: data.title || hostname,
    url,
  } satisfies CrawlSuccessResult;
};
