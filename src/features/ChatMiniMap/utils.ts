import { markdownToTxt } from '@/utils/markdownToTxt';

const MIN_WIDTH = 5;
const MAX_WIDTH = 16;
const MAX_LENGTH = 80;

export const getIndicatorWidth = (content: string | undefined): number => {
  const length = content?.length ?? 0;

  // Smooth sqrt curve so very short messages render small and length grows
  // naturally up to MAX_LENGTH — no piecewise jump.
  const ratio = Math.min(Math.sqrt(length / MAX_LENGTH), 1);
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
