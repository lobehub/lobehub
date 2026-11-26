import { $createQuoteNode } from '@lexical/rich-text';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  type LexicalEditor,
} from 'lexical';

/**
 * Lines of a selection as they go into a quote: line endings normalized, blank lines
 * around the selection dropped, trailing spaces trimmed. Blank lines inside stay, so the
 * selection remains one quote.
 */
export const getQuoteLines = (text: string): string[] => {
  const lines = text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trimEnd());
  const start = lines.findIndex((line) => line.length > 0);
  if (start === -1) return [];
  const end = lines.findLastIndex((line) => line.length > 0);
  return lines.slice(start, end + 1);
};

/**
 * Appends `text` to the end of the draft as a quote, followed by an empty paragraph that
 * receives the caret so the user's next words are their own and not part of the quote.
 * Returns the key of that paragraph, or `undefined` when there is nothing to quote.
 */
export const $appendQuote = (text: string): string | undefined => {
  const lines = getQuoteLines(text);
  if (lines.length === 0) return;

  const quote = $createQuoteNode();
  lines.forEach((line, index) => {
    if (index > 0) quote.append($createLineBreakNode());
    if (line) quote.append($createTextNode(line));
  });

  const root = $getRoot();
  const last = root.getLastChild();
  // An empty last paragraph (an empty draft, or the line left after an earlier quote)
  // becomes the line after this quote instead of a blank line above it.
  let after;
  if ($isParagraphNode(last) && last.isEmpty()) {
    last.insertBefore(quote);
    after = last;
  } else {
    root.append(quote);
    after = $createParagraphNode();
    root.append(after);
  }
  after.selectEnd();
  return after.getKey();
};

/**
 * Quotes `text` at the end of the composer's draft, then focuses the composer with the
 * caret on the line after the quote, scrolled into view below a long draft.
 */
export const quoteIntoEditor = (editor: LexicalEditor, text: string): boolean => {
  if (getQuoteLines(text).length === 0) return false;

  let caretKey: string | undefined;

  editor.update(
    () => {
      caretKey = $appendQuote(text);
    },
    {
      onUpdate: () => {
        if (!caretKey) return;
        editor.focus();
        editor.getElementByKey(caretKey)?.scrollIntoView({ block: 'nearest' });
      },
    },
  );

  return true;
};
