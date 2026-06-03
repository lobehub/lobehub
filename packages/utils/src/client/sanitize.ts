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
 * Strip every `on*` event handler attribute, regardless of DOM engine.
 *
 * DOMPurify normally removes these via `FORBID_ATTR` / its profile allowlist, but that path
 * relies on the underlying DOM's attribute + namespace handling, which differs across engines
 * (jsdom vs happy-dom) and DOMPurify versions — in some environments `on*` handlers on
 * SVG-namespaced nodes slip through. This hook guarantees removal independent of that.
 */
const stripEventHandlers = (_node: Node, data: { attrName: string; keepAttr: boolean }) => {
  if (data.attrName.startsWith('on')) data.keepAttr = false;
};

/**
 * Sanitizes SVG content to prevent XSS attacks while preserving safe SVG elements and attributes
 * @param content - The SVG content to sanitize
 * @returns Sanitized SVG content safe for rendering
 */
export const sanitizeSVGContent = (content: string): string => {
  DOMPurify.addHook('uponSanitizeAttribute', stripEventHandlers);
  try {
    return DOMPurify.sanitize(content, {
      FORBID_ATTR: FORBID_EVENT_HANDLERS,
      FORBID_TAGS: ['embed', 'link', 'object', 'script', 'style'],
      KEEP_CONTENT: false,
      USE_PROFILES: { svg: true, svgFilters: true },
    });
  } finally {
    // Remove only the hook we just added so the shared DOMPurify singleton is left untouched.
    DOMPurify.removeHook('uponSanitizeAttribute', stripEventHandlers);
  }
};
