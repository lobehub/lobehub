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

const numberLines = (content: string, firstLineNumber: number): string => {
  if (content === '') return content;
  const lines = content.split('\n');
  // A trailing newline (newline-terminated file) produces a synthetic empty
  // element that isn't a real line — numbering it would claim a line beyond
  // the file's totalLineCount.
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
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
  const body = firstLineNumber === undefined ? content : numberLines(content, firstLineNumber);

  // Only a window that stops before EOF gets a marker — that's the one piece
  // of information the numbered lines can't convey (how much is left). Never
  // display a window past EOF: some services echo the requested range even
  // when the file is shorter.
  const end =
    lineRange && totalLines !== undefined ? Math.min(lineRange[1], totalLines) : lineRange?.[1];
  if (
    truncated ||
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
