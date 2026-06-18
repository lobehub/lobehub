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
 * Matches any `on*` event-handler attribute together with its value — ` onclick="…"`,
 * ` onload='…'`, or unquoted ` onfoo=bar`. SVG has no safe attribute that starts with `on`,
 * so stripping all of them is lossless for legitimate content.
 */
const EVENT_HANDLER_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s/>]+)/gi;

/**
 * Sanitizes SVG content to prevent XSS attacks while preserving safe SVG elements and attributes
 * @param content - The SVG content to sanitize
 * @returns Sanitized SVG content safe for rendering
 */
export const sanitizeSVGContent = (content: string): string => {
  const sanitized = DOMPurify.sanitize(content, {
    FORBID_ATTR: FORBID_EVENT_HANDLERS,
    FORBID_TAGS: ['embed', 'link', 'object', 'script', 'style'],
    KEEP_CONTENT: false,
    USE_PROFILES: { svg: true, svgFilters: true },
  });

  // Defense-in-depth: DOMPurify's attribute-level filtering runs through the underlying DOM's
  // attribute + namespace handling, which is inconsistent across engines (jsdom vs happy-dom) and
  // DOMPurify versions — in some CI environments `on*` handlers on SVG-namespaced nodes are not
  // stripped at all. Scrub them from the serialized output so removal is deterministic everywhere.
  //
  // Apply repeatedly until the string stabilizes: removing one handler can splice the surrounding
  // text into a fresh `on…=` token (e.g. ` on onclick="x"click="y"` → ` onclick="y"`), which a
  // single pass would miss.
  let scrubbed = sanitized;
  let previous: string;
  do {
    previous = scrubbed;
    scrubbed = scrubbed.replaceAll(EVENT_HANDLER_ATTR, '');
  } while (scrubbed !== previous);

  return scrubbed;
};
