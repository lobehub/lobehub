/**
 * Built-in block list patterns that should always be excluded from folder uploads
 * These patterns follow gitignore syntax
 */
export const BUILT_IN_BLOCK_LIST = [
  '.git/',
  'node_modules/',
  '.DS_Store',
  'Thumbs.db',
  '__pycache__/',
  '*.pyc',
  '.idea/',
  '.vscode/',
] as const;

/**
 * Parse .gitignore content into patterns
 * @param content - .gitignore file content
 * @returns Array of patterns (comments and empty lines removed)
 */
export const parseGitignore = (content: string): string[] => {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')); // Remove empty lines and comments
};

/**
 * Convert gitignore pattern to regex
 * Supports basic gitignore syntax: *, **, ?, negation (!), directory markers (/)
 * @param pattern - Gitignore pattern
 * @returns RegExp to match file paths
 */
const gitignorePatternToRegex = (pattern: string): RegExp => {
  let regexPattern = pattern;

  // Handle negation
  if (regexPattern.startsWith('!')) {
    regexPattern = regexPattern.slice(1);
  }

  // Escape special regex characters except *, ?, and /
  regexPattern = regexPattern.replaceAll(/[$()+.[\\\]^{|}]/g, '\\$&');

  // Handle directory marker at the end
  const isDirectory = regexPattern.endsWith('/');
  if (isDirectory) {
    regexPattern = regexPattern.slice(0, -1);
  }

  // Convert gitignore wildcards to regex
  // ** matches any number of directories
  regexPattern = regexPattern.replaceAll('**', '§DOUBLESTAR§');
  // * matches anything except /
  regexPattern = regexPattern.replaceAll('*', '[^/]*');
  // ? matches any single character except /
  regexPattern = regexPattern.replaceAll('?', '[^/]');
  // Restore **
  regexPattern = regexPattern.replaceAll('§DOUBLESTAR§', '.*');

  // Handle leading/trailing slashes
  if (pattern.startsWith('/')) {
    // Absolute path from root
    regexPattern = '^' + regexPattern.slice(1);
  } else if (!regexPattern.includes('/')) {
    // No slash = match in any directory
    regexPattern = '(^|/)' + regexPattern;
  } else {
    // Relative path
    regexPattern = '(^|/)' + regexPattern;
  }

  // Handle directory marker
  if (isDirectory) {
    regexPattern = regexPattern + '(/|$)';
  } else {
    regexPattern = regexPattern + '(/|$)';
  }

  return new RegExp(regexPattern);
};

/**
 * Check if a file path should be ignored based on gitignore patterns
 * @param filePath - Relative file path (e.g., "folder/file.txt")
 * @param patterns - Array of gitignore patterns
 * @returns true if the file should be ignored
 */
export const shouldIgnoreFile = (filePath: string, patterns: string[]): boolean => {
  let ignored = false;

  for (const pattern of patterns) {
    const isNegation = pattern.startsWith('!');
    const actualPattern = isNegation ? pattern.slice(1) : pattern;
    const regex = gitignorePatternToRegex(actualPattern);

    if (regex.test(filePath)) {
      ignored = !isNegation;
    }
  }

  return ignored;
};

/**
 * Find .gitignore file in the uploaded files
 * @param files - Array of files to search
 * @returns .gitignore file if found, undefined otherwise
 */
export const findGitignoreFile = (files: File[]): File | undefined => {
  return files.find((file) => {
    const path = (file as any).webkitRelativePath || file.name;
    const fileName = path.split('/').pop();
    return fileName === '.gitignore';
  });
};

/**
 * Read .gitignore file content
 * @param file - .gitignore file
 * @returns Promise resolving to file content
 */
export const readGitignoreContent = async (file: File): Promise<string> => {
  return file.text();
};

/**
 * Filter files based on built-in block list
 * @param files - Array of files to filter
 * @returns Filtered array of files (blocked files removed)
 */
export const filterFilesByBuiltInBlockList = (files: File[]): File[] => {
  const patterns = [...BUILT_IN_BLOCK_LIST];

  return files.filter((file) => {
    const path = (file as any).webkitRelativePath || file.name;
    // Remove root folder name from path for matching
    const relativePath = path.split('/').slice(1).join('/');

    return !shouldIgnoreFile(relativePath, patterns);
  });
};

/**
 * Filter files based on .gitignore patterns
 * @param files - Array of files to filter
 * @param gitignoreContent - Content of .gitignore file
 * @returns Filtered array of files (ignored files removed)
 */
export const filterFilesByGitignore = (files: File[], gitignoreContent: string): File[] => {
  const patterns = parseGitignore(gitignoreContent);

  return files.filter((file) => {
    const path = (file as any).webkitRelativePath || file.name;
    // Remove root folder name from path for matching
    const relativePath = path.split('/').slice(1).join('/');

    return !shouldIgnoreFile(relativePath, patterns);
  });
};
