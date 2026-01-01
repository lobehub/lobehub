import { markdownToTxt } from 'markdown-to-txt';

const MIN_WIDTH = 12;
const MAX_WIDTH = 24;
const MAX_CONTENT_LENGTH = 320;

export const getIndicatorWidth = (content: string | undefined): number => {
  if (!content) return MIN_WIDTH;

  const ratio = Math.min(content.length / MAX_CONTENT_LENGTH, 1);

  return MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * ratio;
};

export const getPreviewText = (content: string | undefined): string => {
  if (!content) return '';

  const plainText = markdownToTxt(content);
  const normalized = plainText.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) return '';

  return normalized.slice(0, 100) + (normalized.length > 100 ? '…' : '');
};

export const MIN_MESSAGES_THRESHOLD = 3;
