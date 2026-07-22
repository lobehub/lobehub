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

interface CreateElementContextParams {
  element: { html: string; selector: string; tag: string; text: string };
  /** Localized chip label, e.g. "Element". */
  elementTitle: string;
  id: string;
  url?: string;
}

/** A picked element becomes a text context chip: where it is, what it says, and its markup. */
export const createElementContext = ({
  element,
  elementTitle,
  id,
  url,
}: CreateElementContextParams): ChatContextContent => {
  const text = element.text.trim();
  const html = element.html.trim();
  const label = element.selector.trim() || `<${element.tag || 'element'}>`;

  const header = [url?.trim() && `Source: ${url.trim()}`, `Element: ${label}`]
    .filter(Boolean)
    .join('\n');

  return {
    content: [header, text, html && `\`\`\`html\n${html}\n\`\`\``].filter(Boolean).join('\n\n'),
    format: 'text',
    id,
    preview: getContextPreview(text || html, label),
    source: 'text',
    title: `${elementTitle}: ${label}`,
    type: 'text',
  };
};

/** Turn a captured data URL into a File the chat upload pipeline accepts. */
export const dataUrlToFile = (dataUrl: string, fileName: string): File => {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta?.match(/data:(.*?);base64/)?.[1] || 'image/png';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
};

/** Unique enough that back-to-back captures never collide on the upload list's name key. */
export const buildScreenshotFileName = (title?: string, now: Date = new Date()): string => {
  const slug =
    title
      ?.trim()
      .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 40) || 'page';
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('') +
    '-' +
    [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('');
  return `screenshot-${slug}-${stamp}.png`;
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
