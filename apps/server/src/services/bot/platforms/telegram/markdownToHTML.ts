/**
 * Convert standard Markdown to Telegram-compatible HTML.
 *
 * Telegram HTML mode supports: <b>, <i>, <s>, <u>, <code>, <pre>, <a href="">,
 * <blockquote>, <tg-spoiler>.
 *
 * Characters `<`, `>`, `&` must be escaped outside of tags.
 *
 * Strategy:
 * 1. Extract fenced code blocks first (protect from further processing)
 * 2. Escape HTML entities in remaining text
 * 3. Convert inline markdown to HTML tags
 * 4. Convert block-level markdown to HTML tags
 * 5. Re-insert code blocks
 */
export function markdownToTelegramHTML(md: string): string {
  // 1. Extract fenced code blocks and replace with placeholders
  const codeBlocks: string[] = [];
  let text = md.replaceAll(/^```(\w*)\n([\s\S]*?)^```/gm, (_match, lang: string, code: string) => {
    const escaped = escapeHTML(code.replace(/\n$/, ''));
    const block = lang
      ? `<pre><code class="language-${lang}">${escaped}</code></pre>`
      : `<pre>${escaped}</pre>`;
    codeBlocks.push(block);
    return `\x00CODEBLOCK_${codeBlocks.length - 1}\x00`;
  });

  // 2. Extract inline code and replace with placeholders
  const inlineCodes: string[] = [];
  text = text.replaceAll(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCodes.push(`<code>${escapeHTML(code)}</code>`);
    return `\x00INLINECODE_${inlineCodes.length - 1}\x00`;
  });

  // 3. Escape HTML entities in remaining text
  text = escapeHTML(text);

  // 4. Block-level transforms

  // Headings → bold
  text = text.replaceAll(/^#{1,6}\s+(.+)/gm, '<b>$1</b>');

  // Blockquotes
  text = text.replaceAll(/^&gt;\s?(.*)/gm, '<blockquote>$1</blockquote>');
  // Merge consecutive blockquote tags
  text = text.replaceAll('</blockquote>\n<blockquote>', '\n');

  // 5. Inline transforms (order matters: bold+italic first)

  // Bold + italic: ***text*** or ___text___
  text = text.replaceAll(/\*{3}(.+?)\*{3}/g, '<b><i>$1</i></b>');
  text = text.replaceAll(/_{3}(.+?)_{3}/g, '<b><i>$1</i></b>');

  // Bold: **text** or __text__
  text = text.replaceAll(/\*{2}(.+?)\*{2}/g, '<b>$1</b>');
  text = text.replaceAll(/_{2}(.+?)_{2}/g, '<b>$1</b>');

  // Italic: *text* or _text_
  text = text.replaceAll(/\*(.+?)\*/g, '<i>$1</i>');
  text = text.replaceAll(/(^|[\s(])_(.+?)_([\s).,:;!?]|$)/g, '$1<i>$2</i>$3');

  // Strikethrough: ~~text~~
  text = text.replaceAll(/~~(.+?)~~/g, '<s>$1</s>');

  // Links: [text](url) — already escaped, so &gt; etc. won't appear in url typically
  // Need to handle the escaped brackets: after escapeHTML, [ and ] are unchanged, ( and ) too
  text = text.replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images: ![alt](url) → just show alt as link
  text = text.replaceAll(/!\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 6. Re-insert inline code
  text = text.replaceAll(/\0INLINECODE_(\d+)\0/g, (_match, idx: string) => {
    return inlineCodes[Number.parseInt(idx)];
  });

  // 7. Re-insert code blocks
  text = text.replaceAll(/\0CODEBLOCK_(\d+)\0/g, (_match, idx: string) => {
    return codeBlocks[Number.parseInt(idx)];
  });

  return text;
}

function escapeHTML(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
