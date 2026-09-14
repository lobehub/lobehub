import { escapeXmlAttr, escapeXmlContent } from './xmlEscape';

export interface CrawlResultItem {
  content?: string;
  contentType?: 'text' | 'json';
  description?: string;
  length?: number;
  siteName?: string;
  title?: string;
  url: string;
}

export interface CrawlErrorItem {
  content?: string;
  errorMessage: string;
  errorType: string;
  url?: string;
}

/**
 * Convert crawl results array to compact XML format for token efficiency
 * Uses attributes for metadata and element content for main text
 *
 * @example
 * ```typescript
 * const results = [
 *   { title: "Page Title", url: "https://example.com", content: "..." }
 * ];
 * const xml = crawlResultsPrompt(results);
 * // Output:
 * // <crawlResults>
 * //   <page title="Page Title" url="https://example.com">...</page>
 * // </crawlResults>
 * ```
 */
export const crawlResultsPrompt = (results: Array<CrawlResultItem | CrawlErrorItem>): string => {
  if (results.length === 0) return '<no_crawl_results />';

  const items = results
    .map((item) => {
      // Handle error items
      if ('errorMessage' in item) {
        const attrs: string[] = [
          `errorType="${escapeXmlAttr(item.errorType)}"`,
          `errorMessage="${escapeXmlAttr(item.errorMessage)}"`,
        ];

        if (item.url) {
          attrs.push(`url="${escapeXmlAttr(item.url)}"`);
        }

        // The crawler puts model-facing guidance in `content` (e.g. "dead link, do not
        // retry"); keep it visible instead of collapsing the error to two attributes.
        const guidance = item.content ? escapeXmlContent(item.content) : '';

        return guidance
          ? `  <error ${attrs.join(' ')}>${guidance}</error>`
          : `  <error ${attrs.join(' ')} />`;
      }

      // Handle successful crawl items
      const attrs: string[] = [`url="${escapeXmlAttr(item.url)}"`];

      if (item.title) {
        attrs.push(`title="${escapeXmlAttr(item.title)}"`);
      }

      if (item.contentType) {
        attrs.push(`contentType="${escapeXmlAttr(item.contentType)}"`);
      }

      if (item.description) {
        attrs.push(`description="${escapeXmlAttr(item.description)}"`);
      }

      if (item.length !== undefined) {
        attrs.push(`length="${item.length}"`);
      }

      const attrString = attrs.join(' ');
      const content = item.content ? escapeXmlContent(item.content) : '';

      return content ? `  <page ${attrString}>${content}</page>` : `  <page ${attrString} />`;
    })
    .join('\n');

  return `<crawlResults>\n${items}\n</crawlResults>`;
};
