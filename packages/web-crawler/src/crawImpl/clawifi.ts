import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { HTTPStatusError, PageNotFoundError, toFetchError } from '../utils/errorType';
import { createHTTPStatusError, parseJSONResponse } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

type ClawifiContentStatus = 'ok' | 'thin' | 'blocked' | 'needs_javascript' | 'not_found';

interface ClawifiWebDocument {
  content_markdown?: string;
  excerpt?: string | null;
  title?: string | null;
  url?: string;
}

interface ClawifiFetchResponse {
  content_status?: ClawifiContentStatus;
  data?: ClawifiWebDocument;
  errors?: { code?: string; message?: string }[];
  success: boolean;
}

interface ClawifiErrorResponse {
  error?: {
    code?: string;
    details?: { status_code?: number };
    message?: string;
  };
}

/**
 * Clawifi answers 424 when the target page itself answered with an HTTP error,
 * and keeps the target's status in `error.details.status_code`.
 */
// Clawifi answers 424 when the target page itself answered with an HTTP error, with the target's status here
const getTargetStatus = async (res: Response): Promise<number | undefined> => {
  try {
    const body = (await res.clone().json()) as ClawifiErrorResponse;
    const status = body?.error?.details?.status_code;

    return typeof status === 'number' ? status : undefined;
  } catch {
    return undefined;
  }
};

/**
 * @see https://clawifi.dev/docs/api/post-fetch
 */
export const clawifi: CrawlImpl = async (url) => {
  // Get API key from environment variable
  const apiKey = process.env.CLAWIFI_API_KEY;

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch('https://api.clawifi.dev/fetch', {
          body: JSON.stringify({ url }),
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
    if (res.status === 424) {
      const targetStatus = await getTargetStatus(res);

      // A target 404/410 is the page's final answer, so keep its status and don't retry
      if (targetStatus === 404 || targetStatus === 410) {
        throw new PageNotFoundError(targetStatus === 410 ? 'Gone' : 'Not Found', targetStatus);
      }

      // A target 408/429/5xx is transient, so report the target's status and keep the crawl retryable
      if (targetStatus && (targetStatus === 408 || targetStatus === 429 || targetStatus >= 500)) {
        throw new HTTPStatusError(
          `Clawifi request failed: the target page answered with status ${targetStatus}`,
          targetStatus,
        );
      }
    }

    throw await createHTTPStatusError(res, 'Clawifi');
  }

  const data = await parseJSONResponse<ClawifiFetchResponse>(res, 'Clawifi');

  // `blocked`, `needs_javascript` and `not_found` carry no readable content, so let the next crawler try
  if (!data.success || (data.content_status !== 'ok' && data.content_status !== 'thin')) {
    console.warn(
      `[Clawifi] No readable content for URL: ${url} (content_status: ${data.content_status ?? 'unknown'})`,
      data.errors?.[0]?.message ?? '',
    );
    return;
  }

  const content = data.data?.content_markdown;

  // Check if content is empty or too short
  if (!content || content.length < 100) {
    return;
  }

  return {
    content,
    contentType: 'text',
    description: data.data?.excerpt || '',
    length: content.length,
    siteName: new URL(url).hostname,
    title: data.data?.title || '',
    url: data.data?.url || url,
  } satisfies CrawlSuccessResult;
};
