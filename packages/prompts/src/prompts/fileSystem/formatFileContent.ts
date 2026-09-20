export interface FormatFileContentParams {
  content: string;
  /**
   * 1-based line number of the first content line. When set, every line is
   * prefixed with its line number (`   42→...`) so the reader can refer to
   * exact positions without counting.
   */
  firstLineNumber?: number;
  /**
   * Builds the backend-specific readFile arguments for the next window
   * (e.g. local-system uses `loc=[start, end]`, cloud sandbox uses
   * `startLine`/`endLine`). Defaults to the local-system `loc` syntax.
   */
  formatContinuation?: (nextRange: [number, number]) => string;
  lineRange?: [number, number];
  path: string;
  totalLines?: number;
  /**
   * The service cut the content at its character cap, so the window's tail
   * was never delivered. The continuation hint is suppressed — the embedded
   * truncation warning already tells the reader to narrow the range.
   */
  truncated?: boolean;
}

const defaultFormatContinuation = (nextRange: [number, number]): string =>
  `loc=[${nextRange[0]}, ${nextRange[1]}]`;

const numberLines = (content: string, firstLineNumber: number): string => {
  if (content === '') return content;
  const lines = content.split('\n');
  const width = String(firstLineNumber + lines.length - 1).length;
  return lines
    .map((line, index) => `${String(firstLineNumber + index).padStart(width)}→${line}`)
    .join('\n');
};

export const formatFileContent = ({
  path,
  content,
  lineRange,
  totalLines,
  firstLineNumber,
  formatContinuation = defaultFormatContinuation,
  truncated,
}: FormatFileContentParams): string => {
  // Never display a window past EOF: some services echo the requested range
  // even when the file is shorter.
  const end =
    lineRange && totalLines !== undefined ? Math.min(lineRange[1], totalLines) : lineRange?.[1];

  let lineInfo = '';
  if (lineRange) {
    lineInfo =
      totalLines !== undefined
        ? ` (lines ${lineRange[0]}-${end} of ${totalLines})`
        : ` (lines ${lineRange[0]}-${lineRange[1]})`;
  }

  let continuation = '';
  if (
    !truncated &&
    lineRange &&
    totalLines !== undefined &&
    end !== undefined &&
    end < totalLines
  ) {
    // Continue with a window the same size as the one just returned.
    const size = Math.max(end - lineRange[0], 1);
    const nextRange: [number, number] = [end, Math.min(end + size, totalLines)];
    continuation = `\n[Showing lines ${lineRange[0]}-${end} of ${totalLines} total. Call readFile again with ${formatContinuation(nextRange)} to continue reading.]`;
  }

  const body = firstLineNumber === undefined ? content : numberLines(content, firstLineNumber);

  return `File: ${path}${lineInfo}\n\n${body}${continuation}`;
};
