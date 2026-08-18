import { markdownToTxt } from '@/utils/markdownToTxt';

/** Table divider rows such as `|------|------|` or `| :--- | ---: |` */
const TABLE_DIVIDER_LINE = /^[\s:|]*-[-\s:|]*$/;

const MAX_LENGTH = 300;

/**
 * Notification bodies are authored as markdown (headings, tables, links, bold).
 * The inbox list is a narrow one-glance surface, so render a flattened plain-text
 * preview instead: strip markdown syntax, drop table dividers, and collapse the
 * whole body into a single line that the list clamps with CSS.
 */
export const toNotificationPreview = (content?: string | null): string => {
  if (!content) return '';

  const text = markdownToTxt(content);
  if (!text) return '';

  const preview = text
    .split('\n')
    .filter((line) => !TABLE_DIVIDER_LINE.test(line))
    // `remove-markdown` keeps table pipes — flatten cells into spaced text
    .map((line) => line.replaceAll('|', ' ').replaceAll(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');

  return preview.length > MAX_LENGTH ? `${preview.slice(0, MAX_LENGTH)}…` : preview;
};
