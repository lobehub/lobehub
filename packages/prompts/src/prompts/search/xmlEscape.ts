/**
 * Escape all XML special characters (safe for both attributes and content)
 * Includes: & < > " '
 */
export const escapeXml = (text: string | undefined | null): string => {
  if (!text) return '';
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
};

/**
 * Escape special characters for XML attributes
 * Includes: & " < >
 */
export const escapeXmlAttr = (text: string | undefined | null): string => {
  if (!text) return '';
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
};

/**
 * Escape special characters for XML content
 * Includes: & < >
 */
export const escapeXmlContent = (text: string | undefined | null): string => {
  if (!text) return '';
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
};
