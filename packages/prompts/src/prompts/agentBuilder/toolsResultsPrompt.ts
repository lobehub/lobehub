import { escapeXmlAttr, escapeXmlContent } from '../search/xmlEscape';

export interface MarketToolResultItem {
  author?: string;
  description?: string;
  identifier: string;
  installed?: boolean;
  name: string;
  tags?: string[];
}

export interface OfficialToolResultItem {
  author?: string;
  description?: string;
  enabled?: boolean;
  identifier: string;
  installed?: boolean;
  name: string;
  status?: 'connected' | 'error' | 'pending_auth';
  type: 'builtin' | 'klavis';
}

/**
 * Convert market tools search results to compact XML format for token efficiency
 *
 * @example
 * ```typescript
 * const tools = [
 *   { identifier: "search-engine", name: "Search Engine", installed: true, description: "Web search" }
 * ];
 * const xml = marketToolsResultsPrompt(tools);
 * // Output:
 * // <marketTools>
 * //   <tool id="search-engine" name="Search Engine" installed="true">Web search</tool>
 * // </marketTools>
 * ```
 */
export const marketToolsResultsPrompt = (tools: MarketToolResultItem[]): string => {
  if (tools.length === 0) return '<marketTools />';

  const items = tools
    .map((tool) => {
      const attrs: string[] = [
        `id="${escapeXmlAttr(tool.identifier)}"`,
        `name="${escapeXmlAttr(tool.name)}"`,
      ];

      if (tool.installed) attrs.push('installed="true"');
      if (tool.author) attrs.push(`author="${escapeXmlAttr(tool.author)}"`);
      if (tool.tags && tool.tags.length > 0) {
        attrs.push(`tags="${escapeXmlAttr(tool.tags.join(', '))}"`);
      }

      const attrString = attrs.join(' ');
      const content = tool.description ? escapeXmlContent(tool.description) : '';

      return content ? `  <tool ${attrString}>${content}</tool>` : `  <tool ${attrString} />`;
    })
    .join('\n');

  return `<marketTools>\n${items}\n</marketTools>`;
};

/**
 * Convert official tools search results to compact XML format for token efficiency
 *
 * @example
 * ```typescript
 * const tools = [
 *   { identifier: "web-browsing", name: "Web Browsing", type: "builtin", enabled: true }
 * ];
 * const xml = officialToolsResultsPrompt(tools);
 * // Output:
 * // <officialTools>
 * //   <tool id="web-browsing" name="Web Browsing" type="builtin" enabled="true" />
 * // </officialTools>
 * ```
 */
export const officialToolsResultsPrompt = (tools: OfficialToolResultItem[]): string => {
  if (tools.length === 0) return '<officialTools />';

  const items = tools
    .map((tool) => {
      const attrs: string[] = [
        `id="${escapeXmlAttr(tool.identifier)}"`,
        `name="${escapeXmlAttr(tool.name)}"`,
        `type="${escapeXmlAttr(tool.type)}"`,
      ];

      if (tool.enabled) attrs.push('enabled="true"');
      if (tool.installed) attrs.push('installed="true"');
      if (tool.status) attrs.push(`status="${escapeXmlAttr(tool.status)}"`);
      if (tool.author) attrs.push(`author="${escapeXmlAttr(tool.author)}"`);

      const attrString = attrs.join(' ');
      const content = tool.description ? escapeXmlContent(tool.description) : '';

      return content ? `  <tool ${attrString}>${content}</tool>` : `  <tool ${attrString} />`;
    })
    .join('\n');

  return `<officialTools>\n${items}\n</officialTools>`;
};
