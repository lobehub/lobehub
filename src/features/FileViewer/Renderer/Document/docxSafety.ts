import type { Options } from 'docx-preview';

/**
 * docx-preview options for rendering an uploaded file.
 *
 * `renderAltChunks` defaults to `true`, which embeds each `w:altChunk` (an
 * imported HTML/RTF part) as an iframe holding the part's raw markup. That
 * markup comes from the file, unfiltered, so altChunks are not rendered.
 */
export const DOCX_RENDER_OPTIONS: Partial<Options> = {
  renderAltChunks: false,
};

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Nothing docx-preview should emit outside altChunks; removed in case a future
// version or another path starts producing them.
const ACTIVE_CONTENT_SELECTOR = 'iframe, frame, object, embed, script';

const isSafeHref = (href: string): boolean => {
  const value = href.trim();
  // In-document bookmark links (`#_Toc…`) stay clickable.
  if (value.startsWith('#')) return value.length > 1;

  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    // Relative targets would navigate the app itself; there is nothing to
    // resolve them against in a standalone document.
    return false;
  }
};

/**
 * Strip what docx-preview copies verbatim from the file and the browser would
 * execute: active embeds, and hyperlink targets such as `javascript:` that run
 * on click. Hyperlinks keep their text; only the unsafe target is removed.
 */
export const sanitizeRenderedDocx = (root: HTMLElement): void => {
  for (const element of root.querySelectorAll(ACTIVE_CONTENT_SELECTOR)) element.remove();

  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!isSafeHref(anchor.getAttribute('href') ?? '')) anchor.removeAttribute('href');
  }
};
