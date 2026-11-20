/**
 * Linq delivers a `text` part **verbatim** — the API docs are explicit that
 * "Markdown syntax will be delivered as plain text". An agent reply containing
 * `**bold**` would therefore reach the user as literal asterisks, so every
 * outbound leg (direct REST sends, proactive push, link notifications) degrades
 * markdown to plain text first.
 *
 * Deliberate difference from `chat`'s `toPlainText(ast)`, which the official
 * adapter uses for its `fromAst` path: link targets are kept as
 * `label (https://…)` rather than dropped. A chat bubble that silently loses the
 * URL an agent just sent is a functional loss, and the server's established
 * plain-text renderer (`apps/server/.../stripMarkdown.ts`) keeps them too.
 */

const CODE_BLOCK_PLACEHOLDER = '\u0000LINQ_CODE_BLOCK_';
const INLINE_CODE_PLACEHOLDER = '\u0000LINQ_INLINE_CODE_';

const restore = (text: string, placeholder: string, values: string[]): string =>
  text.replaceAll(new RegExp(`${placeholder}(\\d+)\\u0000`, 'g'), (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : value;
  });

/**
 * Degrade markdown to the plain text a Linq text part can carry.
 *
 * Fenced and inline code are lifted out first so their contents survive the
 * inline rules untouched (a code sample full of `*` is not emphasis).
 */
export const markdownToPlainText = (markdown: string): string => {
  const trimmed = markdown.trim();
  if (!trimmed) return '';

  const codeBlocks: string[] = [];
  let text = trimmed.replaceAll(
    /^ {0,3}```[\w-]*\r?\n([\s\S]*?)^ {0,3}```/gm,
    (_match, content: string) => {
      const index = codeBlocks.push(content.replace(/\n$/, '')) - 1;
      return `${CODE_BLOCK_PLACEHOLDER}${index}\u0000`;
    },
  );

  const inlineCode: string[] = [];
  text = text.replaceAll(/`([^`\n]+)`/g, (_match, code: string) => {
    const index = inlineCode.push(code) - 1;
    return `${INLINE_CODE_PLACEHOLDER}${index}\u0000`;
  });

  // Links and images first, so `[**bold**](url)` keeps its target and an image
  // degrades to its alt text (or the URL when there is no alt).
  text = text.replaceAll(
    /!?\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g,
    (_match, label: string, url: string) => {
      const labelText = (label ?? '').trim();
      return labelText ? `${labelText} (${url})` : url;
    },
  );

  // Block-level syntax.
  text = text.replaceAll(/^ {0,3}#{1,6}[ \t]+/gm, '');
  text = text.replaceAll(/^[ \t]*>[ \t]?/gm, '');
  text = text.replaceAll(/^ {0,3}[-*_]{3,}[ \t]*$/gm, '---');

  // Inline emphasis. `_` rules are boundary-anchored so `snake_case_names`
  // survive; `*` cannot appear inside ordinary prose.
  text = text.replaceAll(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1');
  text = text.replaceAll(/(^|[\s(])__([^_\n]+)__(?=[\s).,:;!?]|$)/gm, '$1$2');
  text = text.replaceAll(/(^|[\s(])_([^_\n]+)_(?=[\s).,:;!?]|$)/gm, '$1$2');
  text = text.replaceAll(/~~([^~\n]+)~~/g, '$1');

  text = restore(text, INLINE_CODE_PLACEHOLDER, inlineCode);
  text = restore(text, CODE_BLOCK_PLACEHOLDER, codeBlocks);

  return text.trim();
};
