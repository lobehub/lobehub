interface ParsedReadContent {
  content: string;
  path?: string;
}

const LINE_NUMBER_PREFIX = /^\s*\d+:\s?/;

export const parseOpenCodeReadContent = (content: string): ParsedReadContent => {
  const contentStart = content.indexOf('<content>');
  const contentEnd = content.indexOf('</content>', contentStart);
  if (contentStart < 0 || contentEnd < 0) return { content };

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
  const markerStart = Math.max(endMarker, continuationMarker);
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
    path: filePath,
  };
};
