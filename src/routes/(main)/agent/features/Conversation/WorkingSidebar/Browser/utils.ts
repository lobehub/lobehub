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

const getContextPreview = (content: string, fallback: string): string => {
  const text = content.replaceAll(/\s+/g, ' ').trim() || fallback;
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
};

interface CreateElementContextParams {
  element: {
    html: string;
    pageTitle?: string;
    selector: string;
    tag: string;
    text: string;
    thumbnailUrl?: string;
    url?: string;
  };
  /** Localized chip label, e.g. "Element". */
  elementTitle: string;
  id: string;
}

/**
 * A picked element becomes a first-class element context: the model gets the
 * text content (source, selector, text, markup); the UI gets the structured
 * `element` (tag, selector, thumbnail) to render its own chip.
 */
export const createElementContext = ({
  element,
  elementTitle,
  id,
}: CreateElementContextParams): ChatContextContent => {
  const text = element.text.trim();
  const html = element.html.trim();
  const url = element.url?.trim();
  const label = element.selector.trim() || `<${element.tag || 'element'}>`;

  const header = [url && `Source: ${url}`, `Element: ${label}`].filter(Boolean).join('\n');

  return {
    content: [header, text, html && `\`\`\`html\n${html}\n\`\`\``].filter(Boolean).join('\n\n'),
    element: {
      pageTitle: element.pageTitle?.trim() || undefined,
      selector: element.selector.trim(),
      tag: element.tag || 'element',
      thumbnailUrl: element.thumbnailUrl,
      url,
    },
    format: 'text',
    id,
    preview: getContextPreview(text || html, label),
    source: 'element',
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

/**
 * The upload pipeline keys the draft item's id on `file.name`, and captures can
 * be fired while the previous upload is still in flight — a name collision
 * strands the second attachment in a forever-pending state. Millisecond
 * precision keeps back-to-back captures distinct.
 */
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
    [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('') +
    '-' +
    String(now.getMilliseconds()).padStart(3, '0');
  return `screenshot-${slug}-${stamp}.png`;
};
