const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

export interface HtmlOpeningTag {
  body?: string;
  end: number;
  start: number;
  tagName: string;
  text: string;
}

const isTagNameBoundary = (value: string | undefined): boolean =>
  !value || value === '>' || value === '/' || /\s/.test(value);

export const findTagEnd = (content: string, start: number): number => {
  let quote: '"' | "'" | undefined;
  let afterEquals = false;
  let inUnquotedValue = false;

  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];

    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (inUnquotedValue) {
      if (char === '>') return index + 1;
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
      if (char === '>') return index + 1;
      inUnquotedValue = true;
      continue;
    }

    if (char === '=') {
      afterEquals = true;
      continue;
    }

    if (char === '>') return index + 1;
  }

  return -1;
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
  let index = 0;

  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start === -1) return;

    if (html.startsWith('<!--', start)) {
      if (html.startsWith('<!-->', start)) {
        index = start + 5;
        continue;
      }
      if (html.startsWith('<!--->', start)) {
        index = start + 6;
        continue;
      }
      const commentEnd = html.indexOf('-->', start + 4);
      if (commentEnd === -1) return;
      index = commentEnd + 3;
      continue;
    }

    const firstChar = html[start + 1];
    if (!firstChar || !/[a-z]/i.test(firstChar)) {
      index = start + 1;
      continue;
    }

    let nameEnd = start + 1;
    while (nameEnd < html.length && /[a-z0-9-]/i.test(html[nameEnd])) nameEnd += 1;

    if (!isTagNameBoundary(html[nameEnd])) {
      index = nameEnd;
      continue;
    }

    const end = findTagEnd(html, start);
    if (end === -1) return;

    const tagName = html.slice(start + 1, nameEnd).toLowerCase();
    let body: string | undefined;
    let nextIndex = end;

    if (RAW_TEXT_TAGS.has(tagName)) {
      const close = findRawTextClose(html, tagName, end);
      if (close) {
        body = html.slice(end, close.closeStart);
        nextIndex = close.closeEnd;
      } else {
        nextIndex = html.length;
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
