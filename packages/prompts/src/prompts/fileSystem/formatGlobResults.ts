export interface FormatGlobResultsParams {
  files: string[];
  maxDisplay?: number;
  totalFiles: number;
}

export const formatGlobResults = ({
  totalFiles,
  files,
  maxDisplay = 50,
}: FormatGlobResultsParams): string => {
  const message = `Found ${totalFiles} files`;

  if (files.length === 0) {
    return message;
  }

  const displayFiles = files.slice(0, maxDisplay);
  const fileList = displayFiles.map((f) => `  ${f}`).join('\n');
  const moreInfo = files.length > maxDisplay ? `\n  ... and ${files.length - maxDisplay} more` : '';

  return `${message}:\n${fileList}${moreInfo}`;
};
