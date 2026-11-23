const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);
const FOREIGN_BREAKOUT_TAGS = new Set([
  'b',
  'big',
  'blockquote',
  'body',
  'br',
  'center',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'hr',
  'i',
  'img',
  'li',
  'listing',
  'menu',
  'meta',
  'nobr',
  'ol',
  'p',
  'pre',
  'ruby',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tt',
  'u',
  'ul',
  'var',
]);

type ForeignRootTag = 'math' | 'svg';

interface ForeignSegment {
  math: number;
  svg: number;
  tags: ForeignRootTag[];
}

export interface HtmlOpeningTag {
  body?: string;
  end: number;
  start: number;
  tagName: string;
  text: string;
}

const isTagNameBoundary = (value: string | undefined): boolean =>
  !value || value === '>' || value === '/' || /\s/.test(value);

const scanTagEnd = (
  content: string,
  start: number,
): { end: number; selfClosing: boolean } | undefined => {
  let quote: '"' | "'" | undefined;
  let afterEquals = false;
  let inUnquotedValue = false;
  let sawSlash = false;

  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];

    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (inUnquotedValue) {
      if (char === '>') return { end: index + 1, selfClosing: false };
      if (/\s/.test(char)) inUnquotedValue = false;
      continue;
    }

    if (afterEquals) {
      if (/\s/.test(char)) continue;
      afterEquals = false;
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '>') return { end: index + 1, selfClosing: false };
      inUnquotedValue = true;
      continue;
    }

    if (char === '>') return { end: index + 1, selfClosing: sawSlash };

    if (char === '/') {
      sawSlash = true;
      continue;
    }

    sawSlash = false;

    if (char === '=') {
      afterEquals = true;
    }
  }
};

export const findTagEnd = (content: string, start: number): number =>
  scanTagEnd(content, start)?.end ?? -1;

const findCommentEnd = (html: string, start: number): number => {
  if (html.startsWith('<!-->', start)) return start + 5;
  if (html.startsWith('<!--->', start)) return start + 6;

  const standardEnd = html.indexOf('-->', start + 4);
  const bangEnd = html.indexOf('--!>', start + 4);

  if (standardEnd === -1) return bangEnd === -1 ? -1 : bangEnd + 4;
  if (bangEnd === -1 || standardEnd < bangEnd) return standardEnd + 3;
  return bangEnd + 4;
};

const findRawTextClose = (
  html: string,
  tagName: string,
  from: number,
): { closeEnd: number; closeStart: number } | undefined => {
  const closeLength = tagName.length + 2;
  let searchFrom = from;

  while (searchFrom < html.length) {
    const closeStart = html.indexOf('</', searchFrom);
    if (closeStart === -1) return;

    const nameEnd = closeStart + closeLength;
    if (
      html.slice(closeStart + 2, nameEnd).toLowerCase() !== tagName ||
      !isTagNameBoundary(html[nameEnd])
    ) {
      searchFrom = closeStart + 2;
      continue;
    }

    const gtIndex = html.indexOf('>', nameEnd);
    if (gtIndex === -1) return;

    return { closeEnd: gtIndex + 1, closeStart };
  }
};

export const walkHtmlTags = (
  html: string,
  onTag: (tag: HtmlOpeningTag) => boolean | void,
): void => {
  const segments: ForeignSegment[] = [{ math: 0, svg: 0, tags: [] }];
  let index = 0;

  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start === -1) return;

    if (html.startsWith('<!--', start)) {
      const commentEnd = findCommentEnd(html, start);
      if (commentEnd === -1) return;
      index = commentEnd;
      continue;
    }

    const firstChar = html[start + 1];
    if (!firstChar) return;

    const segment = segments.at(-1)!;

    if (firstChar === '!' || firstChar === '?') {
      if (segment.tags.length > 0 && html.startsWith('<![CDATA[', start)) {
        const cdataEnd = html.indexOf(']]>', start + 9);
        if (cdataEnd === -1) return;
        index = cdataEnd + 3;
        continue;
      }

      const bogusEnd = html.indexOf('>', start + 2);
      if (bogusEnd === -1) return;
      index = bogusEnd + 1;
      continue;
    }

    if (firstChar === '/') {
      const secondChar = html[start + 2];
      if (!secondChar) return;
      if (secondChar === '>') {
        index = start + 3;
        continue;
      }
      if (!/[a-z]/i.test(secondChar)) {
        const bogusEnd = html.indexOf('>', start + 2);
        if (bogusEnd === -1) return;
        index = bogusEnd + 1;
        continue;
      }

      let nameEnd = start + 2;
      while (nameEnd < html.length && /[a-z0-9-]/i.test(html[nameEnd])) nameEnd += 1;

      const tagEnd = scanTagEnd(html, start);
      if (!tagEnd) return;

      if (isTagNameBoundary(html[nameEnd])) {
        const closeTagName = html.slice(start + 2, nameEnd).toLowerCase();
        if (closeTagName === 'foreignobject') {
          if (segments.length > 1) segments.pop();
        } else if (
          (closeTagName === 'svg' || closeTagName === 'math') &&
          segment[closeTagName] > 0
        ) {
          while (segment.tags.length > 0) {
            const popped = segment.tags.pop()!;
            segment[popped] -= 1;
            if (popped === closeTagName) break;
          }
        }
      }

      index = tagEnd.end;
      continue;
    }

    if (!/[a-z]/i.test(firstChar)) {
      index = start + 1;
      continue;
    }

    let nameEnd = start + 1;
    while (nameEnd < html.length && /[a-z0-9-]/i.test(html[nameEnd])) nameEnd += 1;

    if (!isTagNameBoundary(html[nameEnd])) {
      index = nameEnd;
      continue;
    }

    const tagEnd = scanTagEnd(html, start);
    if (!tagEnd) return;

    const { end, selfClosing } = tagEnd;
    const tagName = html.slice(start + 1, nameEnd).toLowerCase();

    if (segment.tags.length > 0 && FOREIGN_BREAKOUT_TAGS.has(tagName)) {
      segment.tags.length = 0;
      segment.math = 0;
      segment.svg = 0;
    }

    const inForeign = segment.tags.length > 0;
    let body: string | undefined;
    let nextIndex = end;

    if (RAW_TEXT_TAGS.has(tagName) && !(inForeign && selfClosing)) {
      const close = findRawTextClose(html, tagName, end);
      if (close) {
        body = html.slice(end, close.closeStart);
        nextIndex = close.closeEnd;
      } else {
        nextIndex = html.length;
      }
    } else if (!selfClosing) {
      if (tagName === 'svg' || tagName === 'math') {
        segment.tags.push(tagName);
        segment[tagName] += 1;
      } else if (segment.tags.at(-1) === 'svg' && tagName === 'foreignobject') {
        segments.push({ math: 0, svg: 0, tags: [] });
      }
    }

    if (onTag({ body, end, start, tagName, text: html.slice(start, end) }) === false) return;
    index = nextIndex;
  }
};

export const findOpeningTag = (
  content: string,
  tagName: string,
): { end: number; start: number; text: string } | undefined => {
  const target = tagName.toLowerCase();
  let found: { end: number; start: number; text: string } | undefined;

  walkHtmlTags(content, (tag) => {
    if (tag.tagName !== target) return;
    found = { end: tag.end, start: tag.start, text: tag.text };
    return false;
  });

  return found;
};

export const findAttribute = (
  tagText: string,
  attributeName: string,
): { end: number; start: number; value: string } | undefined => {
  const lowerAttributeName = attributeName.toLowerCase();
  let index = 1;

  while (index < tagText.length - 1) {
    while (index < tagText.length && /\s/.test(tagText[index])) index += 1;

    const nameStart = index;
    while (index < tagText.length && /[^\s=/>]/.test(tagText[index])) index += 1;

    if (nameStart === index) {
      index += 1;
      continue;
    }

    const name = tagText.slice(nameStart, index).toLowerCase();
    while (index < tagText.length && /\s/.test(tagText[index])) index += 1;

    if (tagText[index] !== '=') continue;
    index += 1;

    while (index < tagText.length && /\s/.test(tagText[index])) index += 1;

    const valueStart = index;
    const quote = tagText[index] === '"' || tagText[index] === "'" ? tagText[index] : undefined;

    if (quote) {
      index += 1;
      const quotedValueStart = index;
      while (index < tagText.length && tagText[index] !== quote) index += 1;

      const value = tagText.slice(quotedValueStart, index);
      if (index < tagText.length) index += 1;

      if (name === lowerAttributeName) return { end: index, start: nameStart, value };
      continue;
    }

    while (index < tagText.length && !/[\s"'=<>`]/.test(tagText[index])) index += 1;

    if (name === lowerAttributeName) {
      return { end: index, start: nameStart, value: tagText.slice(valueStart, index) };
    }
  }
};

export const extractHtmlTitle = (html: string): string | undefined => {
  let title: string | undefined;

  walkHtmlTags(html, (tag) => {
    if (tag.tagName !== 'title' || tag.body === undefined) return;
    title = tag.body.replaceAll(/\s+/g, ' ').trim() || undefined;
    return false;
  });

  return title;
};

const isRemoteHref = (href: string): boolean =>
  /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//');

/**
 * Drop a workspace-local `<base href>` from a relocated copy. Every resource
 * href in the copy is rewritten relative to the copy's own directory, so a
 * surviving base would send resolution back to the original layout. A remote
 * base is left alone: it governs refs this pipeline never copies.
 */
export const removeLocalBaseTag = (html: string): string => {
  const baseTag = findOpeningTag(html, 'base');
  if (!baseTag) return html;

  const href = findAttribute(baseTag.text, 'href')?.value;
  if (!href || isRemoteHref(href)) return html;

  return html.slice(0, baseTag.start) + html.slice(baseTag.end);
};
