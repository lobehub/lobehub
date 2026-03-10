export interface FileSearchResultItem {
  path: string;
}

export const formatFileSearchResults = (results: FileSearchResultItem[]): string => {
  if (results.length === 0) {
    return 'No files found';
  }

  const fileList = results.map((f) => `  ${f.path}`).join('\n');
  return `Found ${results.length} file(s):\n${fileList}`;
};
