export interface FileListItem {
  isDirectory: boolean;
  name: string;
}

export const formatFileList = (files: FileListItem[], directory: string): string => {
  if (files.length === 0) {
    return `Directory ${directory} is empty`;
  }

  const fileList = files.map((f) => `  ${f.isDirectory ? '[D]' : '[F]'} ${f.name}`).join('\n');
  return `Found ${files.length} item(s) in ${directory}:\n${fileList}`;
};
