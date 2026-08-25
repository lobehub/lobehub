const isTagNameBoundary = (value: string | undefined): boolean =>
  !value || value === '>' || value === '/' || /\s/.test(value);

export const findTagEnd = (content: string, start: number): number => {
  let quote: '"' | "'" | undefined;

  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];

    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') return index + 1;
  }

  return -1;
};

export const findOpeningTag = (
  content: string,
  tagName: string,
): { end: number; start: number; text: string } | undefined => {
  const lowerContent = content.toLowerCase();
  const tagPrefix = `<${tagName}`;
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const start = lowerContent.indexOf(tagPrefix, searchFrom);
    if (start === -1) return;

    if (!isTagNameBoundary(content[start + tagPrefix.length])) {
      searchFrom = start + tagPrefix.length;
      continue;
    }

    const end = findTagEnd(content, start);
    if (end === -1) return;

    return { end, start, text: content.slice(start, end) };
  }
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
  const match = html.match(/<title>([\S\s]*?)<\/title>/i);
  const title = match?.[1]?.replaceAll(/\s+/g, ' ').trim();
  return title || undefined;
};
