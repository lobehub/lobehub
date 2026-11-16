/** Escape text for the XML-like blocks wake prompts are written in; newlines stay on one line. */
export const escapeXmlText = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(/\r?\n/g, '&#10;');

export const escapeXmlAttribute = (text: string) => escapeXmlText(text).replaceAll('"', '&quot;');
