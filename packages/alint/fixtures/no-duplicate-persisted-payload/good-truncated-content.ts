// Fixture: the model gets a truncated preview, the card keeps the full page;
// the two copies differ on purpose.
import type { CrawlResult, WebBrowsingResult } from './types';

const MODEL_CONTENT_LIMIT = 8000;

export function toCrawlToolResult(page: CrawlResult): WebBrowsingResult {
  const truncated = page.content.length > MODEL_CONTENT_LIMIT;

  return {
    content: truncated
      ? `${page.content.slice(0, MODEL_CONTENT_LIMIT)}\n…(truncated)`
      : page.content,
    state: {
      fullContent: truncated ? page.content : undefined,
      title: page.title,
      url: page.url,
    },
    success: true,
  };
}
