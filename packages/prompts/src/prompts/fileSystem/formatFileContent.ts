export interface FormatFileContentParams {
  content: string;
  /**
   * 1-based line number of the first content line. When set, every line is
   * prefixed with its line number (right-aligned, space-separated) so the
   * reader can refer to exact positions without counting.
   */
  firstLineNumber?: number;
  lineRange?: [number, number];
  totalLines?: number;
  /**
   * The service cut the content at its character cap, so the window's tail
   * was never delivered. The window marker is suppressed — it would claim
   * coverage the payload doesn't have; the embedded truncation warning
   * already tells the reader to narrow the range.
   */
  truncated?: boolean;
}

/**
 * Mirrors the service's 500K char cap, re-applied after the gutter expands
 * the payload: numbering 500K blank lines would otherwise balloon the output
 * to several megabytes.
 */
const MAX_FORMATTED_CHARS = 500_000;

const numberLines = (
  content: string,
  firstLineNumber: number,
  expectedLineCount?: number,
): string => {
  if (content === '') return content;
  const lines = content.split('\n');
  // A trailing newline produces a synthetic empty element that isn't a real
  // line — but a window ending on a genuine blank line has the same shape
  // (e.g. `a\n\nb` read with loc [0, 2] arrives as `a\n`). Only drop the
  // terminal element when the line metadata confirms it is phantom.
  if (
    expectedLineCount !== undefined &&
    lines.length === expectedLineCount + 1 &&
    lines.at(-1) === ''
  ) {
    lines.pop();
  }
  const width = String(firstLineNumber + lines.length - 1).length;
  return lines
    .map((line, index) => `${String(firstLineNumber + index).padStart(width)} ${line}`)
    .join('\n');
};

export const formatFileContent = ({
  content,
  lineRange,
  totalLines,
  firstLineNumber,
  truncated,
}: FormatFileContentParams): string => {
  // Never display a window past EOF: some services echo the requested range
  // even when the file is shorter.
  const end =
    lineRange && totalLines !== undefined ? Math.min(lineRange[1], totalLines) : lineRange?.[1];
  const expectedLineCount = lineRange && end !== undefined ? end - lineRange[0] : totalLines;

  let body =
    firstLineNumber === undefined
      ? content
      : numberLines(content, firstLineNumber, expectedLineCount);

  let capped = false;
  if (body.length > MAX_FORMATTED_CHARS) {
    body = `${body.slice(0, MAX_FORMATTED_CHARS)}\n[output truncated at ${MAX_FORMATTED_CHARS} chars after adding line numbers. Use a smaller line range or grep to narrow down.]`;
    capped = true;
  }

  // Only a window that stops before EOF gets a marker — that's the one piece
  // of information the numbered lines can't convey (how much is left). A
  // capped payload never claims the full window.
  if (
    truncated ||
    capped ||
    !lineRange ||
    totalLines === undefined ||
    end === undefined ||
    end >= totalLines
  ) {
    return body;
  }

  const start = firstLineNumber ?? lineRange[0];
  const marker = `(lines ${start}-${start + (end - lineRange[0]) - 1} of ${totalLines})`;

  return `${marker}\n${body}`;
};
