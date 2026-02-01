export interface FileListItem {
  isDirectory: boolean;
  modifiedTime?: Date;
  name: string;
  size?: number;
}

export interface FormatFileListParams {
  /** Directory path */
  directory: string;
  /** List of files to format */
  files: FileListItem[];
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

export const formatFileList = ({
  files,
  directory,
  sortBy,
  sortOrder,
  totalCount: totalCountParam,
}: FormatFileListParams): string => {
  if (files.length === 0) {
    return `Directory ${directory} is empty`;
  }

  // Check if we have extended info (size and modifiedTime)
  const hasExtendedInfo = files.some((f) => f.size !== undefined || f.modifiedTime !== undefined);

  // Use totalCount if available, otherwise use files.length
  const totalCount = totalCountParam ?? files.length;
  const isTruncated = totalCount > files.length;

  let header = `Found ${totalCount} item(s) in ${directory}`;

  // Add sorting and limit info if provided
  const parts: string[] = [];
  if (isTruncated) {
    parts.push(`showing first ${files.length}`);
  }
  if (sortBy) {
    parts.push(`sorted by ${sortBy} ${sortOrder || 'desc'}`);
  }
  if (parts.length > 0) {
    header += ` (${parts.join(', ')})`;
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
