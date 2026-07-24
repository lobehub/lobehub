const escapeHtmlAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

const BASE_TAG_PATTERN = /<base(?:\s[^>]*)?>/i;
const HREF_ATTRIBUTE_PATTERN = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const HEAD_OPEN_PATTERN = /<head(?:\s[^>]*)?>/i;
const HTML_OPEN_PATTERN = /<html(?:\s[^>]*)?>/i;

export const applyHtmlPreviewBaseUrl = (content: string, baseUrl?: string): string => {
  if (!baseUrl) return content;

  const existingBase = content.match(BASE_TAG_PATTERN);
  const existingHref = existingBase?.[0].match(HREF_ATTRIBUTE_PATTERN);
  if (existingBase && existingHref) {
    const sourceHref = existingHref[1] ?? existingHref[2] ?? existingHref[3] ?? '';

    try {
      const resolvedHref = new URL(sourceHref, baseUrl).toString();
      const updatedBase = existingBase[0].replace(
        existingHref[0],
        `href="${escapeHtmlAttribute(resolvedHref)}"`,
      );
      return content.replace(existingBase[0], updatedBase);
    } catch {
      // Invalid author-provided base URLs fall back to the filesystem base.
    }
  }

  const baseElement = `<base href="${escapeHtmlAttribute(baseUrl)}">`;
  const headOpen = content.match(HEAD_OPEN_PATTERN);
  if (headOpen && headOpen.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return `${content.slice(0, insertAt)}${baseElement}${content.slice(insertAt)}`;
  }

  const htmlOpen = content.match(HTML_OPEN_PATTERN);
  if (htmlOpen && htmlOpen.index !== undefined) {
    const insertAt = htmlOpen.index + htmlOpen[0].length;
    return `${content.slice(0, insertAt)}<head>${baseElement}</head>${content.slice(insertAt)}`;
  }

  return `<!doctype html><html><head>${baseElement}</head><body>${content}</body></html>`;
};
