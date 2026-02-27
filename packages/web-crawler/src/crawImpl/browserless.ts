import qs from 'query-string';
import urlJoin from 'url-join';

import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';
import { createHTTPStatusError } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

const BASE_URL = process.env.BROWSERLESS_URL ?? 'https://chrome.browserless.io';
// Allowed file types: html, css, js, json, xml, webmanifest, txt, md
const REJECT_REQUEST_PATTERN =
  '.*\\.(?!(html|css|js|json|xml|webmanifest|txt|md)(\\?|#|$))[\\w-]+(?:[\\?#].*)?$';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

const BROWSERLESS_BLOCK_ADS = process.env.BROWSERLESS_BLOCK_ADS === '1';
const BROWSERLESS_STEALTH_MODE = process.env.BROWSERLESS_STEALTH_MODE === '1';

class BrowserlessInitError extends Error {
  constructor() {
    super('`BROWSERLESS_URL` or `BROWSERLESS_TOKEN` are required');
    this.name = 'BrowserlessInitError';
  }
}

export const browserless: CrawlImpl = async (url, { filterOptions }) => {
  if (!process.env.BROWSERLESS_URL && !process.env.BROWSERLESS_TOKEN) {
    throw new BrowserlessInitError();
  }

  const input = {
    gotoOptions: { waitUntil: 'networkidle2' },
    rejectRequestPattern: [REJECT_REQUEST_PATTERN],
    url,
  };

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(
          qs.stringifyUrl({
            query: {
              blockAds: BROWSERLESS_BLOCK_ADS,
              launch: JSON.stringify({ stealth: BROWSERLESS_STEALTH_MODE }),
              token: BROWSERLESS_TOKEN,
            },
            url: urlJoin(BASE_URL, '/content'),
          }),
          {
            body: JSON.stringify(input),
            headers: {
              'Content-Type': 'application/json',
            },
            method: 'POST',
            signal,
          },
        ),
      DEFAULT_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new PageNotFoundError(res.statusText);
    }

    throw await createHTTPStatusError(res, 'Browserless');
  }

  const html = await res.text();
  const result = htmlToMarkdown(html, { filterOptions, url });

  if (
    !!result.content &&
    result.content.length > 100 &&
    result.title &&
    // "Just a moment..." indicates being blocked by CloudFlare
    result.title.trim() !== 'Just a moment...'
  ) {
    return {
      content: result.content,
      contentType: 'text',
      description: result?.description,
      length: result.length,
      siteName: result?.siteName,
      title: result?.title,
      url,
    } satisfies CrawlSuccessResult;
  }

  return;
};
