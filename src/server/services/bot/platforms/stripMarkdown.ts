/**
 * Convert Markdown to readable plain text for platforms that don't support Markdown rendering.
 *
 * Design goals:
 * - Preserve readability and structure (line breaks, indentation, lists)
 * - Remove syntactic noise (**, `, #, []() etc.)
 * - Keep code block content intact (just remove the fences)
 * - Convert links to "text (url)" format so URLs are still accessible
 * - Convert tables to a readable plain-text layout tuned for mobile chat,
 *   where proportional fonts make column-aligned ASCII tables unreliable.
 */

const CODE_BLOCK_PLACEHOLDER = '\u0000CODEBLOCK_';

/**
 * Split a Markdown table row on unescaped `|`.
 * Handles cells that legitimately contain `\|` (escaped pipe).
 */
function splitTableRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);

  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      buf += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf);
  return cells.map((c) => c.trim());
}

/**
 * Render a parsed table as plain text, picking a layout based on column count.
 *
 * - 1 column → plain bullet list of values
 * - 2–3 columns → single-line "- header: value, header: value" records
 * - 4+ columns → multi-line record blocks prefixed with 【N】, one field per line
 *
 * Mobile chat clients wrap long single-line messages awkwardly; splitting
 * wide tables into field-per-line blocks keeps each row scannable.
 */
function formatTableAsText(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '';

  const colCount = headers.length;
  const hasMeaningfulHeaders = headers.some((h) => h.length > 0);

  const joinPairs = (cells: string[]): string[] =>
    cells
      .map((cell, i) => {
        const header = headers[i] ?? '';
        const value = cell ?? '';
        if (!hasMeaningfulHeaders || !header) return value;
        if (!value) return '';
        return `${header}: ${value}`;
      })
      .filter((s) => s.length > 0);

  if (colCount <= 1) {
    return rows
      .map((cells) => `- ${(cells[0] ?? '').trim()}`)
      .filter((line) => line !== '- ')
      .join('\n');
  }

  if (colCount >= 4) {
    return rows
      .map((cells, idx) => {
        const fields = joinPairs(cells);
        return [`【${idx + 1}】`, ...fields].join('\n');
      })
      .join('\n\n');
  }

  return rows
    .map((cells) => {
      const pairs = joinPairs(cells);
      return pairs.length > 0 ? `- ${pairs.join(', ')}` : '';
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

export function stripMarkdown(md: string): string {
  let text = md;

  // --- Step 1: protect fenced code blocks ---
  // Keep their content intact by swapping in placeholders before any other
  // transform runs. Pipes or `#` inside code would otherwise be mangled by
  // the table/heading rules below.
  // We strip the captured content's trailing `\n` (always present because
  // the closing fence sits on its own line); leaving it in would stack with
  // the newline(s) following the closing fence and produce extra blank lines.
  const codeBlocks: string[] = [];
  text = text.replaceAll(/^```[\w-]*\n([\s\S]*?)^```/gm, (_match, content: string) => {
    const idx = codeBlocks.push(content.replace(/\n$/, '')) - 1;
    return `${CODE_BLOCK_PLACEHOLDER}${idx}\u0000`;
  });

  // --- Step 2: block-level transforms ---

  // Tables → readable plain text. The separator row must contain at least one
  // `-` per our regex, which prevents accidental matches on stray `|`-only lines.
  // The body group `(?:\|.+\|\n?)*` greedily consumes the trailing `\n` after
  // the last row when present; we re-emit it so a blank line that originally
  // separated the table from the following content survives the rewrite.
  text = text.replaceAll(
    /^(\|.+\|)\n\|[\s:|]*-[-\s:|]*\|\n((?:\|.+\|\n?)*)/gm,
    (match, headerRow: string, bodyRows: string) => {
      const headers = splitTableRow(headerRow);
      const rows = bodyRows
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((r: string) => splitTableRow(r));
      const trailingNewline = match.endsWith('\n') ? '\n' : '';
      return formatTableAsText(headers, rows) + trailingNewline;
    },
  );

  // Headings: remove # prefix
  text = text.replaceAll(/^#{1,6}\s+(.+)/gm, '$1');

  // Blockquotes: replace > with vertical bar
  text = text.replaceAll(/^>\s?/gm, '| ');

  // Horizontal rules. Use `[ \t]*$` rather than `\s*$` because `\s` matches
  // `\n`, and in /m mode a trailing `\s*$` would greedily consume the line's
  // terminating newline, swallowing a blank-line separator from the next block.
  text = text.replaceAll(/^[-*_]{3,}[ \t]*$/gm, '---');

  // --- Step 3: inline transforms ---

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

  // --- Step 4: restore protected code blocks ---
  text = text.replaceAll(
    new RegExp(`${CODE_BLOCK_PLACEHOLDER}(\\d+)\\0`, 'g'),
    (_match, idx: string) => codeBlocks[Number(idx)] ?? '',
  );

  return text;
}
