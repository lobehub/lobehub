import {
  formatTextWindowAttributes,
  formatTextWindowNotice,
  type TextWindowRange,
} from '../../textWindow';

/**
 * Line window a file's `content` was cut to. Present only when the caller
 * sliced the file (see `readKnowledge`), so callers that still pass whole
 * files render exactly as before.
 */
export type FileContentRange = TextWindowRange;

export interface FileContent {
  content: string;
  error?: string;
  fileId: string;
  filename: string;
  /**
   * Character count of the original file when its stored text was cut at parse time, so the
   * model learns the text it pages through is not the whole file.
   */
  originalChars?: number;
  range?: FileContentRange;
}

/** The exact readKnowledge call that continues reading `fileId` from a 1-based line. */
export const readKnowledgeContinuation = (fileId: string) => (line: number) =>
  `call readKnowledge with fileIds=["${fileId}"] and offset=${line}`;

/**
 * Formats a single file content with XML tags
 */
const formatFileContent = (file: FileContent): string => {
  if (file.error) {
    return `<file id="${file.fileId}" name="${file.filename}" error="${file.error}" />`;
  }

  const options = {
    continueFrom: readKnowledgeContinuation(file.fileId),
    originalChars: file.originalChars,
  };
  const rangeAttributes = file.range ? formatTextWindowAttributes(file.range, options) : '';
  const notice = file.range ? formatTextWindowNotice(file.range, options) : '';
  const rangeNotice = notice ? `\n${notice}` : '';

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
