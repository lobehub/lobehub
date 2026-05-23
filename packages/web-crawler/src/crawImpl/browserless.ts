import qs from 'query-string';
import urlJoin from 'url-join';

import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';
import { createHTTPStatusError } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

const DEFAULT_BROWSERLESS_URL = 'https://chrome.browserless.io';
const DEFAULT_BROWSERLESS_WAIT_UNTIL = 'load';
// Allowed file types: html, css, js, json, xml, webmanifest, txt, md
const REJECT_REQUEST_PATTERN =
  '.*\\.(?!(html|css|js|json|xml|webmanifest|txt|md)(\\?|#|$))[\\w-]+(?:[\\?#].*)?$';
const BROWSERLESS_WAIT_UNTIL_VALUES = [
  'load',
  'domcontentloaded',
  'networkidle0',
  'networkidle2',
] as const;

type BrowserlessWaitUntil = (typeof BROWSERLESS_WAIT_UNTIL_VALUES)[number];

class BrowserlessInitError extends Error {
  constructor() {
    super('`BROWSERLESS_URL` or `BROWSERLESS_TOKEN` are required');
    this.name = 'BrowserlessInitError';
  }
}

const getBrowserlessWaitUntil = (): BrowserlessWaitUntil => {
  const waitUntil = process.env.BROWSERLESS_WAIT_UNTIL;

  if (waitUntil && BROWSERLESS_WAIT_UNTIL_VALUES.includes(waitUntil as BrowserlessWaitUntil)) {
    return waitUntil as BrowserlessWaitUntil;
  }

  return DEFAULT_BROWSERLESS_WAIT_UNTIL;
};

export const browserless: CrawlImpl = async (url, { filterOptions }) => {
  if (!process.env.BROWSERLESS_URL && !process.env.BROWSERLESS_TOKEN) {
    throw new BrowserlessInitError();
  }

  const baseUrl = process.env.BROWSERLESS_URL ?? DEFAULT_BROWSERLESS_URL;
  const browserlessToken = process.env.BROWSERLESS_TOKEN;
  const browserlessBlockAds = process.env.BROWSERLESS_BLOCK_ADS === '1';
  const browserlessStealthMode = process.env.BROWSERLESS_STEALTH_MODE === '1';

  const input = {
    gotoOptions: { waitUntil: getBrowserlessWaitUntil() },
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
              blockAds: browserlessBlockAds,
              launch: JSON.stringify({ stealth: browserlessStealthMode }),
              token: browserlessToken,
            },
            url: urlJoin(baseUrl, '/content'),
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
