interface FolderInfo {
  name: string;
  parent: string | null;
}

interface FolderTree {
  filesByFolder: Record<string, File[]>;
  folders: Record<string, FolderInfo>;
}

/**
 * Builds a folder tree structure from files with webkitRelativePath
 * @param files - Array of files with webkitRelativePath property
 * @returns Object containing folder hierarchy and files grouped by folder path
 */
export const buildFolderTree = (files: File[]): FolderTree => {
  const folders: Record<string, FolderInfo> = {};
  const filesByFolder: Record<string, File[]> = {};

  for (const file of files) {
    // Get the relative path from the browser (e.g., "my-folder/subfolder/file.txt")
    const relativePath = (file as any).webkitRelativePath || file.name;

    // Split path into segments
    const pathSegments = relativePath.split('/');

    // If there's no path (single file), skip folder processing
    if (pathSegments.length === 1) {
      if (!filesByFolder['']) {
        filesByFolder[''] = [];
      }
      filesByFolder[''].push(file);
      continue;
    }

    // Remove the file name to get folder path segments
    const folderSegments = pathSegments.slice(0, -1);

    // Build folder hierarchy
    let currentPath = '';
    for (let i = 0; i < folderSegments.length; i++) {
      const folderName = folderSegments[i];
      const parentPath = i > 0 ? folderSegments.slice(0, i).join('/') : null;
      currentPath = i === 0 ? folderName : `${currentPath}/${folderName}`;

      // Only add folder if we haven't seen it before
      if (!folders[currentPath]) {
        folders[currentPath] = {
          name: folderName,
          parent: parentPath,
        };
      }
    }

    // Add file to its parent folder
    const folderPath = folderSegments.join('/');
    if (!filesByFolder[folderPath]) {
      filesByFolder[folderPath] = [];
    }
    filesByFolder[folderPath].push(file);
  }

  return { filesByFolder, folders };
};

/**
 * Sorts folder paths by depth (topological sort for tree structure)
 * Ensures parent folders are created before their children
 * @param folders - Record of folder paths to folder info
 * @returns Array of folder paths sorted by depth (shallow to deep)
 */
export const topologicalSortFolders = (folders: Record<string, FolderInfo>): string[] => {
  const folderPaths = Object.keys(folders);

  // Sort by number of path separators (depth)
  // Folders with fewer separators are higher in the hierarchy
  return folderPaths.sort((a, b) => {
    const depthA = (a.match(/\//g) || []).length;
    const depthB = (b.match(/\//g) || []).length;
    return depthA - depthB;
  });
};

/**
 * Sanitizes folder name by removing or replacing invalid characters
 * @param name - Original folder name
 * @returns Sanitized folder name safe for storage
 */
export const sanitizeFolderName = (name: string): string => {
  // Replace invalid characters with underscores
  // Keep alphanumeric, spaces, hyphens, and underscores
  // eslint-disable-next-line no-control-regex
  return name.replaceAll(/[\u0000-\u001F"*/:<>?\\|]/g, '_').trim();
};
