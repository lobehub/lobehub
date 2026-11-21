import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

interface DeepSeekFetchResponse {
  /**
   * Page body as Markdown
   */
  content?: string;
  title?: string;
}

/**
 * DeepSeek renders uncached pages on demand, which regularly takes 5-10s+, so the
 * shared 10s default cuts off pages it would have returned. Keep a larger
 * `CRAWLER_TIMEOUT` when one is configured.
 */
const DEEPSEEK_TIMEOUT = Math.max(DEFAULT_TIMEOUT, 20_000);

/**
 * DeepSeek backslash-escapes every ASCII punctuation character in the page text
 * (`\#`, `\.`, `\/`, ...), which shows up verbatim in previews and inflates the
 * tokens handed to the model. Undo the escapes in a single left-to-right pass so
 * an escaped backslash (`\\`) decodes back to one backslash.
 */
export const unescapeMarkdown = (text: string) =>
  text.replaceAll(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');

/**
 * @see https://api-docs.deepseek.com/zh-cn/guides/search
 */
export const deepseek: CrawlImpl = async (url) => {
  // Fall back to the model provider key so a single DeepSeek key enables crawling too
  const apiKey = process.env.DEEPSEEK_SEARCH_API_KEY || process.env.DEEPSEEK_API_KEY;

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch('https://api.deepseek.com/v1/tools/fetch', {
          body: JSON.stringify({ url }),
          headers: {
            'Authorization': !apiKey ? '' : `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal,
        }),
      DEEPSEEK_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    // DeepSeek answers 404 when no usable content could be fetched from the page
    if (res.status === 404) {
      throw new PageNotFoundError(res.statusText);
    }

    throw await createHTTPStatusError(res, 'DeepSeek');
  }

  const data = await parseJSONResponse<DeepSeekFetchResponse>(res, 'DeepSeek');

  const content = data.content ? unescapeMarkdown(data.content) : '';

  // Check if content is empty or too short
  if (content.length < 100) {
    return;
  }

  return {
    content,
    contentType: 'text',
    length: content.length,
    siteName: new URL(url).hostname,
    title: data.title ? unescapeMarkdown(data.title) : '',
    url,
  } satisfies CrawlSuccessResult;
};
