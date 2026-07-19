import type { ChatContextContent } from '@lobechat/types';

import { DEFAULT_BROWSER_URL } from './const';

const HTTP_URL_PATTERN = /^https?:\/\//i;
const LOCAL_URL_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:[/?#].*)?$/i;

export const normalizeBrowserUrl = (value?: string): string => {
  const text = value?.trim();
  if (!text) return DEFAULT_BROWSER_URL;

  if (text === 'about:blank') return text;

  if (HTTP_URL_PATTERN.test(text)) return text;

  if (LOCAL_URL_PATTERN.test(text)) return `http://${text}`;

  if (text.includes(' ') || !text.includes('.')) {
    const searchUrl = new URL('https://www.bing.com/search');
    searchUrl.searchParams.set('q', text);
    return searchUrl.toString();
  }

  return `https://${text}`;
};

interface CreateBrowserContextParams {
  content: string;
  id: string;
  pageTitle?: string;
  selected: boolean;
  selectionTitle: string;
  url?: string;
}

const getContextPreview = (content: string, fallback: string): string => {
  const text = content.replaceAll(/\s+/g, ' ').trim() || fallback;
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
};

export const createBrowserContext = ({
  content,
  id,
  pageTitle,
  selected,
  selectionTitle,
  url,
}: CreateBrowserContextParams): ChatContextContent => {
  const normalizedContent = content.trim();
  const normalizedTitle = pageTitle?.trim() || url?.trim() || selectionTitle;
  const source = url?.trim() ? `Source: ${url.trim()}\n\n` : '';

  return {
    content: `${source}${normalizedContent}`,
    format: 'text',
    id,
    preview: getContextPreview(normalizedContent, normalizedTitle),
    source: 'text',
    title: selected ? `${selectionTitle}: ${normalizedTitle}` : normalizedTitle,
    type: 'text',
  };
};
