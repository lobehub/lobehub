export interface FileListItem {
  isDirectory: boolean;
  modifiedTime?: Date;
  name: string;
  size?: number;
}

export interface FormatFileListOptions {
  /** Maximum number of items requested (for showing "showing X of Y" info) */
  limit?: number;
  /** Sort field used */
  sortBy?: string;
  /** Sort order used */
  sortOrder?: string;
  /** Total count before limit applied */
  totalCount?: number;
}

/**
 * Format file size to human readable string
 */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/**
 * Format date to YYYY-MM-DD HH:mm format
 */
const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

export const formatFileList = (
  files: FileListItem[],
  directory: string,
  options?: FormatFileListOptions,
): string => {
  if (files.length === 0) {
    return `Directory ${directory} is empty`;
  }

  // Check if we have extended info (size and modifiedTime)
  const hasExtendedInfo = files.some((f) => f.size !== undefined || f.modifiedTime !== undefined);

  let header = `Found ${files.length} item(s) in ${directory}`;

  // Add sorting and limit info if provided
  if (options) {
    const parts: string[] = [];
    if (options.totalCount && options.totalCount > files.length) {
      parts.push(`showing ${files.length} of ${options.totalCount}`);
    }
    if (options.sortBy) {
      parts.push(`sorted by ${options.sortBy} ${options.sortOrder || 'desc'}`);
    }
    if (parts.length > 0) {
      header += ` (${parts.join(', ')})`;
    }
  }

  const fileList = files
    .map((f) => {
      const prefix = f.isDirectory ? '[D]' : '[F]';
      const name = f.name;

      if (hasExtendedInfo) {
        const date = f.modifiedTime ? formatDate(f.modifiedTime) : '                ';
        const size = f.isDirectory
          ? '    --'
          : f.size !== undefined
            ? formatFileSize(f.size).padStart(10)
            : '          ';
        return `  ${prefix} ${name.padEnd(40)} ${date}  ${size}`;
      }

      return `  ${prefix} ${name}`;
    })
    .join('\n');

  return `${header}:\n${fileList}`;
};
