interface ParsedReadContent {
  content: string;
  /** Whether OpenCode read framing (1.x `<content>` envelope or 2.x header) was unwrapped. */
  hasEnvelope?: boolean;
  path?: string;
}

const LINE_NUMBER_PREFIX = /^\s*\d+:\s?/;
const READ_MARKER_AT_START = /^\((?:End of file|Showing lines)/;
// OpenCode 2.x: `Read file <path>, lines 10-12` or `Read file <path>, 0 lines`
// on the first line, then numbered lines and an optional truncation notice.
const V2_READ_HEADER = /^Read file (.+), (?:lines \d+-\d+|\d+ lines?)$/;
const V2_TRUNCATION_MARKER = /(?:^|\n)\[Output truncated\b[^\n]*\]$/;

const stripLineNumbers = (content: string): string => {
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const hasLineNumbers =
    nonEmptyLines.length > 0 && nonEmptyLines.every((line) => LINE_NUMBER_PREFIX.test(line));
  return hasLineNumbers
    ? lines.map((line) => line.replace(LINE_NUMBER_PREFIX, '')).join('\n')
    : content;
};

const parseV2ReadContent = (content: string): ParsedReadContent | undefined => {
  const headerEnd = content.indexOf('\n');
  const header = headerEnd < 0 ? content : content.slice(0, headerEnd);
  const filePath = V2_READ_HEADER.exec(header)?.[1];
  if (!filePath) return;

  const body = headerEnd < 0 ? '' : content.slice(headerEnd + 1);
  return {
    content: stripLineNumbers(body.replace(V2_TRUNCATION_MARKER, '').trimEnd()),
    hasEnvelope: true,
    path: filePath,
  };
};

export const parseOpenCodeReadContent = (content: string): ParsedReadContent => {
  const contentStart = content.indexOf('<content>');
  // Resolve the closing tag from the end: the file body itself may contain a
  // literal `</content>` (XML/HTML sources, code handling this envelope).
  const contentEnd = content.lastIndexOf('</content>');
  if (contentStart < 0 || contentEnd < contentStart + '<content>'.length) {
    return parseV2ReadContent(content) ?? { content };
  }

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
  return {
    content: stripLineNumbers(contentWithoutMarker),
    hasEnvelope: true,
    path: filePath,
  };
};
