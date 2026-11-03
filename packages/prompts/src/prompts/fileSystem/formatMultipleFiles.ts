export interface FileContentItem {
  content: string;
  filename: string;
}

export const formatMultipleFiles = (files: FileContentItem[]): string => {
  const fileContents = files.map((f) => `=== ${f.filename} ===\n${f.content}`).join('\n\n');
  return `Read ${files.length} file(s):\n\n${fileContents}`;
};
