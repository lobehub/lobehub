import type { ToolProjector } from '../types';

/**
 * How much of a crawled page body survives projection.
 *
 * The inline card shows `description || content.slice(0, 40)`, so 40 is all the
 * render can consume today; the rest is headroom so a copy tweak doesn't need a
 * server change. The full body lives in the detail portal, which fetches the raw
 * payload on open.
 */
const CRAWL_PREVIEW_CHARS = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const projectCrawlResult = (result: unknown): unknown => {
  if (!isRecord(result)) return result;

  const data = result.data;
  if (!isRecord(data)) return result;

  // An error result's `content` IS what the card prints when `errorMessage` is
  // missing, and it is short by construction. Leave it whole.
  if ('errorType' in data) return result;

  const content = data.content;
  if (typeof content !== 'string' || content.length <= CRAWL_PREVIEW_CHARS) return result;

  return {
    ...result,
    data: {
      ...data,
      content: content.slice(0, CRAWL_PREVIEW_CHARS),
      // The card prints a character count. Pin it from the ORIGINAL body before
      // truncating, or every crawled page would report exactly 200 characters.
      length: typeof data.length === 'number' ? data.length : content.length,
    },
  };
};

/**
 * `crawlSinglePage` / `crawlMultiPages`.
 *
 * The render (`Render/PageContent`) reads `pluginState.results` and the call
 * arguments — never the tool message body, which holds a second copy of the same
 * page text for the model. So the body goes entirely, and each result keeps its
 * card fields plus a preview of the page.
 */
export const crawlProjector: ToolProjector = ({ pluginState }) => {
  if (!isRecord(pluginState) || !Array.isArray(pluginState.results)) {
    // Shape we don't recognise: drop the duplicated body, touch nothing else.
    return { content: null };
  }

  return {
    content: null,
    pluginState: { ...pluginState, results: pluginState.results.map(projectCrawlResult) },
  };
};
