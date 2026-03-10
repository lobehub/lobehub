import { escapeXmlAttr, escapeXmlContent } from './xmlEscape';

export interface SearchResultItem {
  content?: string;
  imgSrc?: string;
  publishedDate?: string | null;
  thumbnail?: string | null;
  title: string;
  url: string;
}

/**
 * Convert search results array to compact XML format for token efficiency
 * Uses attributes for title/url and element content for main text
 *
 * @example
 * ```typescript
 * const results = [
 *   { title: "Example", url: "https://example.com", content: "..." }
 * ];
 * const xml = searchResultsPrompt(results);
 * // Output:
 * // <searchResults>
 * //   <item title="Example" url="https://example.com">...</item>
 * // </searchResults>
 * ```
 */
export const searchResultsPrompt = (results: SearchResultItem[]): string => {
  if (results.length === 0) return '<searchResults>No results found.</searchResults>';

  const items = results
    .map((item) => {
      const attrs: string[] = [
        `title="${escapeXmlAttr(item.title)}"`,
        `url="${escapeXmlAttr(item.url)}"`,
      ];

      if (item.publishedDate) {
        attrs.push(`publishedDate="${escapeXmlAttr(item.publishedDate)}"`);
      }

      if (item.imgSrc) {
        attrs.push(`imgSrc="${escapeXmlAttr(item.imgSrc)}"`);
      }

      if (item.thumbnail) {
        attrs.push(`thumbnail="${escapeXmlAttr(item.thumbnail)}"`);
      }

      const attrString = attrs.join(' ');
      const content = item.content ? escapeXmlContent(item.content) : '';

      return content ? `  <item ${attrString}>${content}</item>` : `  <item ${attrString} />`;
    })
    .join('\n');

  return `<searchResults>\n${items}\n</searchResults>`;
};
