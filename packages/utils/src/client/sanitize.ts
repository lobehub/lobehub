import DOMPurify from 'dompurify';

const FORBID_EVENT_HANDLERS = [
  'onblur',
  'onchange',
  'onclick',
  'onerror',
  'onfocus',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onload',
  'onmousedown',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onreset',
  'onselect',
  'onsubmit',
  'onunload',
];

/**
 * Sanitizes HTML content to prevent XSS attacks while preserving safe HTML elements
 * @param content - The HTML content to sanitize
 * @returns Sanitized HTML content safe for rendering
 */
export const sanitizeHTMLContent = (content: string): string => {
  return DOMPurify.sanitize(content, {
    FORBID_ATTR: FORBID_EVENT_HANDLERS,
    FORBID_TAGS: ['embed', 'link', 'meta', 'object', 'script'],
    KEEP_CONTENT: true,
  });
};

/**
 * Sanitizes SVG content to prevent XSS attacks while preserving safe SVG elements and attributes
 * @param content - The SVG content to sanitize
 * @returns Sanitized SVG content safe for rendering
 */
export const sanitizeSVGContent = (content: string): string => {
  return DOMPurify.sanitize(content, {
    FORBID_ATTR: FORBID_EVENT_HANDLERS,
    FORBID_TAGS: ['embed', 'link', 'object', 'script', 'style'],
    KEEP_CONTENT: false,
    USE_PROFILES: { svg: true, svgFilters: true },
  });
};
