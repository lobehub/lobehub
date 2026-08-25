interface ParsedReadContent {
  content: string;
  /** Whether a complete OpenCode `<content>` envelope was found and unwrapped. */
  hasEnvelope?: boolean;
  path?: string;
}

const LINE_NUMBER_PREFIX = /^\s*\d+:\s?/;
const READ_MARKER_AT_START = /^\((?:End of file|Showing lines)/;

export const parseOpenCodeReadContent = (content: string): ParsedReadContent => {
  const contentStart = content.indexOf('<content>');
  // Resolve the closing tag from the end: the file body itself may contain a
  // literal `</content>` (XML/HTML sources, code handling this envelope).
  const contentEnd = content.lastIndexOf('</content>');
  if (contentStart < 0 || contentEnd < contentStart + '<content>'.length) return { content };

  const header = content.slice(0, contentStart);
  const pathStart = header.indexOf('<path>');
  const pathEnd = header.indexOf('</path>', pathStart);
  const filePath =
    pathStart >= 0 && pathEnd >= 0
      ? header.slice(pathStart + '<path>'.length, pathEnd).trim()
      : undefined;
  const wrappedContent = content.slice(contentStart + '<content>'.length, contentEnd).trim();
  const endMarker = wrappedContent.lastIndexOf('\n(End of file');
  const continuationMarker = wrappedContent.lastIndexOf('\n(Showing lines');
  // An empty file (or an offset past EOF) produces a marker-only payload with
  // no leading newline, so also match a marker at the very start.
  const markerStart = READ_MARKER_AT_START.test(wrappedContent)
    ? 0
    : Math.max(endMarker, continuationMarker);
  const contentWithoutMarker = (
    markerStart >= 0 ? wrappedContent.slice(0, markerStart) : wrappedContent
  ).trimEnd();
  const lines = contentWithoutMarker.split('\n');
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const hasLineNumbers =
    nonEmptyLines.length > 0 && nonEmptyLines.every((line) => LINE_NUMBER_PREFIX.test(line));
  const normalized = hasLineNumbers
    ? lines.map((line) => line.replace(LINE_NUMBER_PREFIX, '')).join('\n')
    : contentWithoutMarker;

  return {
    content: normalized,
    hasEnvelope: true,
    path: filePath,
  };
};
