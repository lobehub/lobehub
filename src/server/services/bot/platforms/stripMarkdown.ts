/**
 * Convert Markdown to readable plain text for platforms that don't support Markdown rendering.
 *
 * Design goals:
 * - Preserve readability and structure (line breaks, indentation, lists)
 * - Remove syntactic noise (**, `, #, []() etc.)
 * - Keep code block content intact (just remove the fences)
 * - Convert links to "text (url)" format so URLs are still accessible
 * - Convert tables to aligned plain-text representation
 */
export function stripMarkdown(md: string): string {
  let text = md;

  // --- Block-level transforms (order matters) ---

  // Fenced code blocks: remove fences, keep content
  text = text.replaceAll(/^```[\w-]*\n([\s\S]*?)^```/gm, '$1');

  // Tables: convert to bullet-style rows
  text = text.replaceAll(
    /^(\|.+\|)\n\|[-\s|:]+\|\n((?:\|.+\|\n?)*)/gm,
    (_match, headerRow: string, bodyRows: string) => {
      const parseRow = (row: string) =>
        row
          .split('|')
          .slice(1, -1)
          .map((c: string) => c.trim());

      const headers = parseRow(headerRow);
      const rows = bodyRows
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((r: string) => parseRow(r));

      return rows
        .map((cells: string[]) =>
          cells.map((cell: string, i: number) => `${headers[i]}: ${cell}`).join(', '),
        )
        .map((line: string) => `- ${line}`)
        .join('\n');
    },
  );

  // Headings: remove # prefix
  text = text.replaceAll(/^#{1,6}\s+(.+)/gm, '$1');

  // Blockquotes: replace > with vertical bar
  text = text.replaceAll(/^>\s?/gm, '| ');

  // Horizontal rules
  text = text.replaceAll(/^[-*_]{3,}\s*$/gm, '---');

  // --- Inline transforms ---

  // Images: ![alt](url) → alt
  text = text.replaceAll(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Links: [text](url) → text (url)
  text = text.replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Bold + italic: ***text*** or ___text___
  text = text.replaceAll(/\*{3}(.+?)\*{3}/g, '$1');
  text = text.replaceAll(/_{3}(.+?)_{3}/g, '$1');

  // Bold: **text** or __text__
  text = text.replaceAll(/\*{2}(.+?)\*{2}/g, '$1');
  text = text.replaceAll(/_{2}(.+?)_{2}/g, '$1');

  // Italic: *text* or _text_
  text = text.replaceAll(/\*(.+?)\*/g, '$1');
  text = text.replaceAll(/(^|[\s(])_(.+?)_([\s).,:;!?]|$)/g, '$1$2$3');

  // Strikethrough: ~~text~~
  text = text.replaceAll(/~~(.+?)~~/g, '$1');

  // Inline code: `text`
  text = text.replaceAll(/`([^`]+)`/g, '$1');

  return text;
}
