export interface FormatFileContentParams {
  content: string;
  lineRange?: [number, number];
  path: string;
}

export const formatFileContent = ({
  path,
  content,
  lineRange,
}: FormatFileContentParams): string => {
  const lineInfo = lineRange ? ` (lines ${lineRange[0]}-${lineRange[1]})` : '';
  return `File: ${path}${lineInfo}\n\n${content}`;
};
