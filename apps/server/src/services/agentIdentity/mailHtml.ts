import { parseHTML } from 'linkedom';

/** Larger than this is not rendered as HTML; the reader falls back to the plain text. */
const MAX_HTML_LENGTH = 2 * 1024 * 1024;

/** Where a remote image waits until the reader asks to load it. */
export const REMOTE_IMAGE_ATTRIBUTE = 'data-lobe-remote-src';

const ALLOWED_TAGS = new Set(
  'a abbr b big blockquote br caption center cite code col colgroup dd del div dl dt em font h1 h2 h3 h4 h5 h6 hr i img ins kbd li ol p pre q s small span strike strong style sub sup table tbody td tfoot th thead tr tt u ul'.split(
    ' ',
  ),
);

/** Dropped with everything inside them, rather than unwrapped to their text. */
const REMOVED_TAGS = new Set(
  'applet audio base button canvas embed frame frameset head iframe input link math meta noscript object script select svg template textarea title video'.split(
    ' ',
  ),
);

const ALLOWED_ATTRIBUTES = new Set(
  'align alt bgcolor border cellpadding cellspacing class color colspan dir face height href hspace lang rowspan size src style title valign vspace width'.split(
    ' ',
  ),
);

const SAFE_LINK = /^(?:https?:|mailto:)/i;
const REMOTE_URL = /^https?:\/\//i;
const EMBEDDED_IMAGE = /^data:image\/(?:gif|jpe?g|png|webp)[,;]/i;

/**
 * The only `url()` CSS keeps: an inline raster image, quoted or not, whose
 * payload cannot hide a quote, a parenthesis or a second function.
 */
const EMBEDDED_CSS_IMAGE =
  /^\s*(["']?)data:image\/(?:gif|jpe?g|png|webp);base64,[\d+/=a-z\s]*\1\s*$/i;

/**
 * CSS functions that fetch what they name, or read an attribute (which is how
 * a stylesheet would reach a held-back image's address). Matched anywhere,
 * prefixed or not, even inside strings: removing too much only costs styling.
 */
const FETCHING_FUNCTION =
  /(?:-(?:moz|ms|o|webkit)-)?(?:attr|cross-fade|element|expression|image|image-set|src|url)\s*\(/gi;

/** At-rules that load a stylesheet or font, removed whole. */
const FETCHING_AT_RULE = /@(?:font-face|import)\b/gi;

/** URL schemes are compared without the whitespace and controls browsers ignore. */
// eslint-disable-next-line no-control-regex
const normalizeUrl = (value: string) => value.replaceAll(/[\u0000- ]/g, '');

/**
 * Resolve CSS escapes, so `\75 rl(` and `u\rl(` read as the `url(` a browser
 * would see. The output keeps no backslash, so it cannot spell a new escape.
 */
const decodeCssEscapes = (css: string) =>
  css
    .replaceAll(
      /\\(?:([\da-f]{1,6})[\t\n\f\r ]?|(\r\n|[\n\f\r])|([\s\S]))/gi,
      (_, hex?: string, newline?: string, char?: string) => {
        if (newline) return '';
        if (char !== undefined) return char;

        const code = Number.parseInt(hex!, 16);
        const valid = code > 0 && code <= 0x10_ffff && (code < 0xd8_00 || code > 0xdf_ff);
        return valid ? String.fromCodePoint(code) : '�';
      },
    )
    .replaceAll('\\', '');

/** Index of the character closing the bracket opened at `open`, or the last index. */
const closingIndex = (css: string, open: number, closer: string): number => {
  const opener = css[open];
  let depth = 0;
  let quote = '';

  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return css.length - 1;
};

/** Where an at-rule starting at `start` ends: its `;`, or the `}` closing its block. */
const atRuleEnd = (css: string, start: number): number => {
  let quote = '';

  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ';') {
      return index;
    } else if (char === '{') {
      return closingIndex(css, index, '}');
    }
  }

  return css.length - 1;
};

const removeFetchingAtRules = (css: string) => {
  let output = '';
  let cursor = 0;

  for (const match of css.matchAll(FETCHING_AT_RULE)) {
    if (match.index < cursor) continue;
    output += css.slice(cursor, match.index);
    cursor = atRuleEnd(css, match.index) + 1;
  }

  return output + css.slice(cursor);
};

const removeFetchingFunctions = (css: string) => {
  let output = '';
  let cursor = 0;

  for (const match of css.matchAll(FETCHING_FUNCTION)) {
    if (match.index < cursor) continue;

    const open = match.index + match[0].length - 1;
    const close = closingIndex(css, open, ')');
    const isUrl = /^url\s*\($/i.test(match[0]);
    const kept = isUrl && EMBEDDED_CSS_IMAGE.test(css.slice(open + 1, close));

    output +=
      css.slice(cursor, match.index) + (kept ? css.slice(match.index, close + 1) : ' none ');
    cursor = close + 1;
  }

  return output + css.slice(cursor);
};

/**
 * Make CSS inert: nothing in it can fetch. Remote `url()`, `image-set()` and
 * their kin, `@import` and `@font-face` are deleted outright, never flagged
 * for later, because no switch in the reader brings them back. Escapes are
 * resolved and comments flattened first, so what is checked is what the
 * browser parses; `<` goes so a stylesheet cannot close its `<style>`.
 */
export const sanitizeMailCss = (css: string): string => {
  const flat = decodeCssEscapes(css)
    .replaceAll('<', '')
    // A space, not nothing: `u/**/rl(` must not join into `url(`.
    .replaceAll(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ');

  return removeFetchingFunctions(removeFetchingAtRules(flat));
};

export interface SanitizedMailHtml {
  /** Whether a remote image was held back, so the reader can offer to load it. */
  hasRemoteContent: boolean;
  html: string;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const sanitizeElement = (element: any, state: { remote: boolean }): void => {
  for (const child of [...element.childNodes]) {
    // Comments, conditional comments and processing instructions carry nothing a reader needs.
    if (child.nodeType !== ELEMENT_NODE) {
      if (child.nodeType !== TEXT_NODE) child.remove();
      continue;
    }

    const tag = child.tagName.toLowerCase();

    if (REMOVED_TAGS.has(tag)) {
      child.remove();
      continue;
    }

    sanitizeElement(child, state);

    if (!ALLOWED_TAGS.has(tag)) {
      child.replaceWith(...child.childNodes);
      continue;
    }

    for (const { name, value } of [...child.attributes]) {
      const attribute = name.toLowerCase();
      if (!ALLOWED_ATTRIBUTES.has(attribute)) {
        child.removeAttribute(name);
      } else if (attribute === 'style') {
        const css = sanitizeMailCss(value).trim();
        if (css) child.setAttribute(name, css);
        else child.removeAttribute(name);
      }
    }

    if (tag === 'a') {
      const href = normalizeUrl(child.getAttribute('href') ?? '');
      if (SAFE_LINK.test(href)) child.setAttribute('href', href);
      else child.removeAttribute('href');
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }

    if (tag === 'img') {
      const src = normalizeUrl(child.getAttribute('src') ?? '');
      child.removeAttribute('src');
      if (EMBEDDED_IMAGE.test(src)) child.setAttribute('src', src);
      else if (REMOTE_URL.test(src)) {
        child.setAttribute(REMOTE_IMAGE_ATTRIBUTE, src);
        state.remote = true;
      }
    }

    if (tag === 'style') child.textContent = sanitizeMailCss(child.textContent ?? '');
  }
};

/**
 * Reduce a mail's HTML to an allowlist of inert markup. Remote images lose their
 * `src` here, so nothing can load until the reader asks; remote CSS is deleted.
 * This is the first of two walls: the reader also renders the result in a
 * script-less sandbox with a CSP, so a parser disagreement here still cannot
 * run anything.
 *
 * Returns `null` when the mail cannot be rendered safely.
 */
export const sanitizeMailHtml = (raw: string): SanitizedMailHtml | null => {
  if (raw.length > MAX_HTML_LENGTH) return null;

  try {
    const source = /<html[\s>]/i.test(raw) ? raw : `<html><body>${raw}</body></html>`;
    const { document } = parseHTML(source);
    const state = { remote: false };

    // Head styles carry most of a newsletter's layout, so they move into the body.
    const styles = [...document.querySelectorAll('head style')];
    if (styles.length > 0) document.body.prepend(...styles);

    sanitizeElement(document.body, state);

    return { hasRemoteContent: state.remote, html: document.body.innerHTML };
  } catch (error) {
    console.error('[AgentMailbox] sanitize html failed', error);
    return null;
  }
};
