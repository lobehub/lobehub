import { stripImageRefs } from '@lobechat/const/imageRef';
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

/**
 * Plain text of a user prompt for a topic title. Inline image references such as `[Image #1]`
 * point at attachments and say nothing about the topic, so they are left out.
 */
export const toTitleText = (prompt: string): string => markdownToTxt(stripImageRefs(prompt)).trim();

export default markdownToTxt;
