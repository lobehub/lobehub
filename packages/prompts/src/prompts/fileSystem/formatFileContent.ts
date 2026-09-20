export interface FormatFileContentParams {
  content: string;
  lineRange?: [number, number];
  path: string;
  totalLines?: number;
}

export const formatFileContent = ({
  path,
  content,
  lineRange,
  totalLines,
}: FormatFileContentParams): string => {
  let lineInfo = '';
  if (lineRange) {
    lineInfo =
      totalLines !== undefined
        ? ` (lines ${lineRange[0]}-${lineRange[1]} of ${totalLines})`
        : ` (lines ${lineRange[0]}-${lineRange[1]})`;
  }

  let continuation = '';
  if (lineRange && totalLines !== undefined && lineRange[1] < totalLines) {
    continuation = `\n[Showing lines ${lineRange[0]}-${lineRange[1]} of ${totalLines} total. Call readFile again with loc=[${lineRange[1]}, ${Math.min(lineRange[1] + 200, totalLines)}] to continue reading.]`;
  }

  return `File: ${path}${lineInfo}\n\n${content}${continuation}`;
};
