import { findAttribute, findOpeningTag } from './htmlTagScanner';

const escapeHtmlAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

export const applyHtmlPreviewBaseUrl = (content: string, baseUrl?: string): string => {
  if (!baseUrl) return content;

  const existingBase = findOpeningTag(content, 'base');
  const existingHref = existingBase && findAttribute(existingBase.text, 'href');
  if (existingBase && existingHref) {
    try {
      const resolvedHref = new URL(existingHref.value, baseUrl).toString();
      const updatedBase = `${existingBase.text.slice(0, existingHref.start)}${`href="${escapeHtmlAttribute(resolvedHref)}"`}${existingBase.text.slice(existingHref.end)}`;
      return `${content.slice(0, existingBase.start)}${updatedBase}${content.slice(existingBase.end)}`;
    } catch {
      // Invalid author-provided base URLs fall back to the filesystem base.
    }
  }

  const baseElement = `<base href="${escapeHtmlAttribute(baseUrl)}">`;
  const headOpen = findOpeningTag(content, 'head');
  if (headOpen) {
    const insertAt = headOpen.end;
    return `${content.slice(0, insertAt)}${baseElement}${content.slice(insertAt)}`;
  }

  const htmlOpen = findOpeningTag(content, 'html');
  if (htmlOpen) {
    const insertAt = htmlOpen.end;
    return `${content.slice(0, insertAt)}<head>${baseElement}</head>${content.slice(insertAt)}`;
  }

  return `<!doctype html><html><head>${baseElement}</head><body>${content}</body></html>`;
};
