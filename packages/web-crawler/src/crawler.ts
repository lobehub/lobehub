import type { CrawlImplType } from './crawImpl';
import { crawlImpls } from './crawImpl';
import type { CrawlErrorResult, CrawlUniformResult, CrawlUrlRule } from './type';
import { crawUrlRules } from './urlRules';
import { applyUrlRules } from './utils/appUrlRules';
import {
  InvalidUrlError,
  isRetryableCrawlError,
  PageNotFoundError,
  UnsupportedContentError,
} from './utils/errorType';
import { getNonDocumentExtension, normalizeCrawlUrl } from './utils/urlPreflight';

const defaultImpls = ['jina', 'naive', 'search1api', 'browserless'] as CrawlImplType[];

/** Pseudo crawler name for failures raised before any provider was contacted. */
const PREFLIGHT_CRAWLER = 'preflight';

interface CrawlOptions {
  impls?: string[];
}

/**
 * Build the error payload handed back to the model. Authoritative failures get an
 * explicit "this is final, do not retry" message so the model changes strategy
 * instead of re-issuing the same (billed) request.
 */
const buildErrorData = (error: Error | undefined): CrawlErrorResult => {
  const errorType = error?.name || 'UnknownError';
  const errorMessage = error?.message;
  const retryable = isRetryableCrawlError(error);

  let content: string;

  if (error instanceof PageNotFoundError) {
    content = `Dead link: the server confirmed this page does not exist (HTTP ${error.status}). This is a final answer — do not retry this URL; find a different source instead.`;
  } else if (error instanceof InvalidUrlError) {
    content = `Invalid URL: ${errorMessage}. Nothing was fetched — pass an absolute http(s) URL.`;
  } else if (error instanceof UnsupportedContentError) {
    content = `Unsupported content: ${errorMessage}. Nothing to read here — only crawl HTML/text document pages.`;
  } else {
    content = `Fail to crawl the page. Error type: ${errorType}, error message: ${errorMessage}`;
  }

  return {
    content,
    errorMessage,
    errorType,
    ...(retryable ? {} : { retryable: false }),
  };
};

export class Crawler {
  impls: CrawlImplType[];

  constructor(options: CrawlOptions = {}) {
    this.impls = !!options.impls?.length
      ? (options.impls.filter((impl) => Object.keys(crawlImpls).includes(impl)) as CrawlImplType[])
      : defaultImpls;
  }

  /**
   * Crawl webpage content
   * @param options Crawl options
   */
  async crawl({
    url,
    impls: userImpls,
    filterOptions: userFilterOptions,
  }: {
    filterOptions?: CrawlUrlRule['filterOptions'];
    impls?: CrawlImplType[];
    url: string;
  }): Promise<CrawlUniformResult> {
    // Preflight: repair or reject the URL before any provider (and its quota) is touched.
    let normalizedUrl = url;

    try {
      normalizedUrl = normalizeCrawlUrl(url);

      const resourceExtension = getNonDocumentExtension(normalizedUrl);
      if (resourceExtension) {
        throw new UnsupportedContentError(
          `URL points to a .${resourceExtension} resource file, which has no readable page content`,
        );
      }
    } catch (error) {
      return {
        crawler: PREFLIGHT_CRAWLER,
        data: buildErrorData(error as Error),
        originalUrl: url,
        transformedUrl: normalizedUrl !== url ? normalizedUrl : undefined,
      };
    }

    // Apply URL rules
    const {
      transformedUrl,
      filterOptions: ruleFilterOptions,
      impls: ruleImpls,
    } = applyUrlRules(normalizedUrl, crawUrlRules);

    // Merge user-provided filter options and rule filter options, user options take priority
    const mergedFilterOptions = {
      ...ruleFilterOptions,
      ...userFilterOptions,
    };

    let finalCrawler: string | undefined;
    let finalError: Error | undefined;

    const filteredRuleImpls = ruleImpls
      ? (ruleImpls.filter((impl) => this.impls.includes(impl as CrawlImplType)) as CrawlImplType[])
      : undefined;
    const systemImpls = (
      filteredRuleImpls?.length ? filteredRuleImpls : this.impls
    ) as CrawlImplType[];

    const finalImpls = userImpls
      ? (userImpls.filter((impl) => Object.keys(crawlImpls).includes(impl)) as CrawlImplType[])
      : systemImpls;

    // Try each implementation in the built-in order
    for (const impl of finalImpls) {
      try {
        const res = await crawlImpls[impl](transformedUrl, { filterOptions: mergedFilterOptions });

        if (res && res.content && res.content.length > 100) {
          return {
            crawler: impl,
            data: res,
            originalUrl: url,
            transformedUrl: transformedUrl !== url ? transformedUrl : undefined,
          };
        }

        console.error(
          `[${impl}] returned empty or short content (length: ${res?.content?.length ?? 0})`,
        );
        finalError = new Error(`${impl} returned empty or short content`);
        finalError.name = 'EmptyCrawlResultError';
        finalCrawler = impl;
      } catch (error) {
        console.error(`[${impl}]`, error);
        finalError = error as Error;
        finalCrawler = impl;

        // A confirmed 404/410 is the page's final answer; asking the next provider
        // only buys the same "not found" again.
        if (error instanceof PageNotFoundError) break;
      }
    }

    return {
      crawler: finalCrawler || finalImpls.at(-1) || 'unknown',
      data: buildErrorData(finalError),
      originalUrl: url,
      transformedUrl: transformedUrl !== url ? transformedUrl : undefined,
    };
  }
}
