/**
 * Line window a file's `content` was cut to. Present only when the caller
 * sliced the file (see `readKnowledge`), so callers that still pass whole
 * files render exactly as before.
 */
export interface FileContentRange {
  /** Present when the window's only line was cut to fit the per-call cap. */
  cutLine?: { keptChars: number; line: number; totalChars: number };
  /** 1-based, inclusive. `0` when the window is empty. */
  endLine: number;
  /** 1-based, inclusive. */
  startLine: number;
  totalCharCount: number;
  totalLineCount: number;
  /** True when lines after `endLine` exist and the model should page. */
  truncated: boolean;
}

export interface FileContent {
  content: string;
  error?: string;
  fileId: string;
  filename: string;
  range?: FileContentRange;
}

const formatRangeAttributes = (range: FileContentRange): string =>
  ` lines="${range.startLine}-${range.endLine}" totalLines="${range.totalLineCount}" totalChars="${range.totalCharCount}" truncated="${range.truncated}"`;

const formatRangeNotice = (range: FileContentRange): string => {
  if (range.endLine === 0) {
    return `\n[offset ${range.startLine} is past the end of this ${range.totalLineCount}-line file; nothing returned. The file is not empty.]`;
  }

  if (range.cutLine) {
    const { keptChars, line, totalChars } = range.cutLine;
    const rest =
      line < range.totalLineCount
        ? ` Call readKnowledge again with offset=${line + 1} to continue with the next line.`
        : '';

    return `\n[Line ${line} is ${totalChars} characters long and was cut at ${keptChars}; the rest of that line cannot be paged.${rest}]`;
  }

  if (!range.truncated) return '';

  return `\n[Showing lines ${range.startLine}-${range.endLine} of ${range.totalLineCount}. Call readKnowledge again with offset=${range.endLine + 1} to continue.]`;
};

/**
 * Formats a single file content with XML tags
 */
const formatFileContent = (file: FileContent): string => {
  if (file.error) {
    return `<file id="${file.fileId}" name="${file.filename}" error="${file.error}" />`;
  }

  const rangeAttributes = file.range ? formatRangeAttributes(file.range) : '';
  const rangeNotice = file.range ? formatRangeNotice(file.range) : '';

  return `<file id="${file.fileId}" name="${file.filename}"${rangeAttributes}>
${file.content}${rangeNotice}
</file>`;
};

/**
 * Format file contents prompt for AI consumption using XML structure
 */
export const promptFileContents = (fileContents: FileContent[]): string => {
  const filesXml = fileContents.map((file) => formatFileContent(file)).join('\n');

  return `<knowledge_base_files totalCount="${fileContents.length}">
<instruction>Use the information from these files to answer the user's question. Always cite the source files.</instruction>
${filesXml}
</knowledge_base_files>`;
};
