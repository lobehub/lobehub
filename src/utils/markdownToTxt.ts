import removeMarkdown from 'remove-markdown';

/**
 * Convert markdown into plain text.
 *
 * This is a local wrapper to avoid importing third-party markdown-to-txt directly.
 * It uses `remark` + `strip-markdown` under the hood.
 */
export const markdownToTxt = (markdown: string): string => {
  if (!markdown) return '';

  try {
    return removeMarkdown(markdown).trimEnd();
  } catch {
    // Best-effort: fall back to raw input when parsing fails.
    return markdown;
  }
};

export default markdownToTxt;
