/* eslint-disable unicorn/no-array-push-push */
import {
  EditLocalFileParams,
  EditLocalFileResult,
  GlobFilesParams,
  GlobFilesResult,
  GrepContentParams,
  GrepContentResult,
  ListLocalFileParams,
  LocalMoveFilesResultItem,
  LocalReadFileParams,
  LocalReadFileResult,
  LocalReadFilesParams,
  LocalSearchFilesParams,
  MoveLocalFilesParams,
  OpenLocalFileParams,
  OpenLocalFolderParams,
  RenameLocalFileResult,
  ShowSaveDialogParams,
  ShowSaveDialogResult,
  WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import { SYSTEM_FILES_TO_IGNORE, loadFile } from '@lobechat/file-loaders';
import { createPatch } from 'diff';
import { dialog, shell } from 'electron';
import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { FileResult, SearchOptions } from '@/modules/fileSearch';
import ContentSearchService from '@/services/contentSearchSrv';
import FileSearchService from '@/services/fileSearchSrv';
import { makeSureDirExist } from '@/utils/file-system';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

// Create logger
const logger = createLogger('controllers:LocalFileCtr');

export default class LocalFileCtr extends ControllerModule {
  static override readonly groupName = 'localSystem';
  private get searchService() {
    return this.app.getService(FileSearchService);
  }

  private get contentSearchService() {
    return this.app.getService(ContentSearchService);
  }

  // ==================== File Operation ====================

  @IpcMethod()
  async handleOpenLocalFile({ path: filePath }: OpenLocalFileParams): Promise<{
    error?: string;
    success: boolean;
  }> {
    logger.debug('Attempting to open file:', { filePath });

    try {
      await shell.openPath(filePath);
      logger.debug('File opened successfully:', { filePath });
      return { success: true };
    } catch (error) {
      logger.error(`Failed to open file ${filePath}:`, error);
      return { error: (error as Error).message, success: false };
    }
  }

  @IpcMethod()
  async handleOpenLocalFolder({ path: targetPath, isDirectory }: OpenLocalFolderParams): Promise<{
    error?: string;
    success: boolean;
  }> {
    const folderPath = isDirectory ? targetPath : path.dirname(targetPath);
    logger.debug('Attempting to open folder:', { folderPath, isDirectory, targetPath });

    try {
      await shell.openPath(folderPath);
      logger.debug('Folder opened successfully:', { folderPath });
      return { success: true };
    } catch (error) {
      logger.error(`Failed to open folder ${folderPath}:`, error);
      return { error: (error as Error).message, success: false };
    }
  }

  @IpcMethod()
  async handleShowSaveDialog({
    defaultPath,
    filters,
    title,
  }: ShowSaveDialogParams): Promise<ShowSaveDialogResult> {
    logger.debug('Showing save dialog:', { defaultPath, filters, title });

    const result = await dialog.showSaveDialog({
      defaultPath,
      filters,
      title,
    });

    logger.debug('Save dialog result:', { canceled: result.canceled, filePath: result.filePath });

    return {
      canceled: result.canceled,
      filePath: result.filePath,
    };
  }

  @IpcMethod()
  async readFiles({ paths }: LocalReadFilesParams): Promise<LocalReadFileResult[]> {
    logger.debug('Starting batch file reading:', { count: paths.length });

    const results: LocalReadFileResult[] = [];

    for (const filePath of paths) {
      // Initialize result object
      logger.debug('Reading single file:', { filePath });
      const result = await this.readFile({ path: filePath });
      results.push(result);
    }

    logger.debug('Batch file reading completed', { count: results.length });
    return results;
  }

  @IpcMethod()
  async readFile({
    path: filePath,
    loc,
    fullContent,
  }: LocalReadFileParams): Promise<LocalReadFileResult> {
    const effectiveLoc = fullContent ? undefined : (loc ?? [0, 200]);
    logger.debug('Starting to read file:', { filePath, fullContent, loc: effectiveLoc });

    try {
      const fileDocument = await loadFile(filePath);

      const lines = fileDocument.content.split('\n');
      const totalLineCount = lines.length;
      const totalCharCount = fileDocument.content.length;

      let content: string;
      let charCount: number;
      let lineCount: number;
      let actualLoc: [number, number];

      if (effectiveLoc === undefined) {
        // Return full content
        content = fileDocument.content;
        charCount = totalCharCount;
        lineCount = totalLineCount;
        actualLoc = [0, totalLineCount];
      } else {
        // Return specified range
        const [startLine, endLine] = effectiveLoc;
        const selectedLines = lines.slice(startLine, endLine);
        content = selectedLines.join('\n');
        charCount = content.length;
        lineCount = selectedLines.length;
        actualLoc = effectiveLoc;
      }

      logger.debug('File read successfully:', {
        filePath,
        fullContent,
        selectedLineCount: lineCount,
        totalCharCount,
        totalLineCount,
      });

      const result: LocalReadFileResult = {
        // Char count for the selected range
        charCount,
        // Content for the selected range
        content,
        createdTime: fileDocument.createdTime,
        fileType: fileDocument.fileType,
        filename: fileDocument.filename,
        lineCount,
        loc: actualLoc,
        // Line count for the selected range
        modifiedTime: fileDocument.modifiedTime,

        // Total char count of the file
        totalCharCount,
        // Total line count of the file
        totalLineCount,
      };

      try {
        const stats = await stat(filePath);
        if (stats.isDirectory()) {
          logger.warn('Attempted to read directory content:', { filePath });
          result.content = 'This is a directory and cannot be read as plain text.';
          result.charCount = 0;
          result.lineCount = 0;
          // Keep total counts for directory as 0 as well, or decide if they should reflect metadata size
          result.totalCharCount = 0;
          result.totalLineCount = 0;
        }
      } catch (statError) {
        logger.error(`Failed to get file status ${filePath}:`, statError);
      }

      return result;
    } catch (error) {
      logger.error(`Failed to read file ${filePath}:`, error);
      const errorMessage = (error as Error).message;
      return {
        charCount: 0,
        content: `Error accessing or processing file: ${errorMessage}`,
        createdTime: new Date(),
        fileType: path.extname(filePath).toLowerCase().replace('.', '') || 'unknown',
        filename: path.basename(filePath),
        lineCount: 0,
        loc: [0, 0],
        modifiedTime: new Date(),
        totalCharCount: 0, // Add total counts to error result
        totalLineCount: 0,
      };
    }
  }

  @IpcMethod()
  async listLocalFiles({
    path: dirPath,
    sortBy = 'modifiedTime',
    sortOrder = 'desc',
    limit = 100,
  }: ListLocalFileParams): Promise<{ files: FileResult[]; totalCount: number }> {
    logger.debug('Listing directory contents:', { dirPath, limit, sortBy, sortOrder });

    const results: FileResult[] = [];
    try {
      const entries = await readdir(dirPath);
      logger.debug('Directory entries retrieved successfully:', {
        dirPath,
        entriesCount: entries.length,
      });

      for (const entry of entries) {
        // Skip specific system files based on the ignore list
        if (SYSTEM_FILES_TO_IGNORE.includes(entry)) {
          logger.debug('Ignoring system file:', { fileName: entry });
          continue;
        }

        const fullPath = path.join(dirPath, entry);
        try {
          const stats = await stat(fullPath);
          const isDirectory = stats.isDirectory();
          results.push({
            createdTime: stats.birthtime,
            isDirectory,
            lastAccessTime: stats.atime,
            modifiedTime: stats.mtime,
            name: entry,
            path: fullPath,
            size: stats.size,
            type: isDirectory ? 'directory' : path.extname(entry).toLowerCase().replace('.', ''),
          });
        } catch (statError) {
          // Silently ignore files we can't stat (e.g. permissions)
          logger.error(`Failed to get file status ${fullPath}:`, statError);
        }
      }

      // Sort entries based on sortBy and sortOrder
      results.sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case 'name': {
            comparison = (a.name || '').localeCompare(b.name || '');
            break;
          }
          case 'modifiedTime': {
            comparison = a.modifiedTime.getTime() - b.modifiedTime.getTime();
            break;
          }
          case 'createdTime': {
            comparison = a.createdTime.getTime() - b.createdTime.getTime();
            break;
          }
          case 'size': {
            comparison = a.size - b.size;
            break;
          }
          default: {
            comparison = a.modifiedTime.getTime() - b.modifiedTime.getTime();
          }
        }

        return sortOrder === 'desc' ? -comparison : comparison;
      });

      const totalCount = results.length;

      // Apply limit
      const limitedResults = results.slice(0, limit);

      logger.debug('Directory listing successful', {
        dirPath,
        resultCount: limitedResults.length,
        totalCount,
      });
      return { files: limitedResults, totalCount };
    } catch (error) {
      logger.error(`Failed to list directory ${dirPath}:`, error);
      // Rethrow or return an empty array/error object depending on desired behavior
      // For now, returning empty result on error listing directory itself
      return { files: [], totalCount: 0 };
    }
  }

  @IpcMethod()
  async handleMoveFiles({ items }: MoveLocalFilesParams): Promise<LocalMoveFilesResultItem[]> {
    logger.debug('Starting batch file move:', { itemsCount: items?.length });

    const results: LocalMoveFilesResultItem[] = [];

    if (!items || items.length === 0) {
      logger.warn('moveLocalFiles called with empty parameters');
      return [];
    }

    // Process each move request
    for (const item of items) {
      const { oldPath: sourcePath, newPath } = item;
      const logPrefix = `[Moving file ${sourcePath} -> ${newPath}]`;
      logger.debug(`${logPrefix} Starting process`);

      const resultItem: LocalMoveFilesResultItem = {
        newPath: undefined,
        sourcePath,
        success: false,
      };

      // Basic validation
      if (!sourcePath || !newPath) {
        logger.error(`${logPrefix} Parameter validation failed: source or target path is empty`);
        resultItem.error = 'Both oldPath and newPath are required for each item.';
        results.push(resultItem);
        continue;
      }

      try {
        // Check if source exists
        try {
          await access(sourcePath, constants.F_OK);
          logger.debug(`${logPrefix} Source file exists`);
        } catch (accessError: any) {
          if (accessError.code === 'ENOENT') {
            logger.error(`${logPrefix} Source file does not exist`);
            throw new Error(`Source path not found: ${sourcePath}`);
          } else {
            logger.error(`${logPrefix} Permission error accessing source file:`, accessError);
            throw new Error(
              `Permission denied accessing source path: ${sourcePath}. ${accessError.message}`,
            );
          }
        }

        // Check if target path is the same as source path
        if (path.normalize(sourcePath) === path.normalize(newPath)) {
          logger.info(`${logPrefix} Source and target paths are identical, skipping move`);
          resultItem.success = true;
          resultItem.newPath = newPath; // Report target path even if not moved
          results.push(resultItem);
          continue;
        }

        // LBYL: Ensure target directory exists
        const targetDir = path.dirname(newPath);
        makeSureDirExist(targetDir);
        logger.debug(`${logPrefix} Ensured target directory exists: ${targetDir}`);

        // Execute move (rename)
        await rename(sourcePath, newPath);
        resultItem.success = true;
        resultItem.newPath = newPath;
        logger.info(`${logPrefix} Move successful`);
      } catch (error) {
        logger.error(`${logPrefix} Move failed:`, error);
        // Use similar error handling logic as handleMoveFile
        let errorMessage = (error as Error).message;
        if ((error as any).code === 'ENOENT')
          errorMessage = `Source path not found: ${sourcePath}.`;
        else if ((error as any).code === 'EPERM' || (error as any).code === 'EACCES')
          errorMessage = `Permission denied to move the item at ${sourcePath}. Check file/folder permissions.`;
        else if ((error as any).code === 'EBUSY')
          errorMessage = `The file or directory at ${sourcePath} or ${newPath} is busy or locked by another process.`;
        else if ((error as any).code === 'EXDEV')
          errorMessage = `Cannot move across different file systems or drives. Source: ${sourcePath}, Target: ${newPath}.`;
        else if ((error as any).code === 'EISDIR')
          errorMessage = `Cannot overwrite a directory with a file, or vice versa. Source: ${sourcePath}, Target: ${newPath}.`;
        else if ((error as any).code === 'ENOTEMPTY')
          errorMessage = `The target directory ${newPath} is not empty (relevant on some systems if target exists and is a directory).`;
        else if ((error as any).code === 'EEXIST')
          errorMessage = `An item already exists at the target path: ${newPath}.`;
        // Keep more specific errors from access or directory checks
        else if (
          !errorMessage.startsWith('Source path not found') &&
          !errorMessage.startsWith('Permission denied accessing source path') &&
          !errorMessage.includes('Target directory')
        ) {
          // Keep the original error message if none of the specific codes match
        }
        resultItem.error = errorMessage;
      }
      results.push(resultItem);
    }

    logger.debug('Batch file move completed', {
      successCount: results.filter((r) => r.success).length,
      totalCount: results.length,
    });
    return results;
  }

  @IpcMethod()
  async handleRenameFile({
    path: currentPath,
    newName,
  }: {
    newName: string;
    path: string;
  }): Promise<RenameLocalFileResult> {
    const logPrefix = `[Renaming ${currentPath} -> ${newName}]`;
    logger.debug(`${logPrefix} Starting rename request`);

    // Basic validation (can also be done in frontend action)
    if (!currentPath || !newName) {
      logger.error(`${logPrefix} Parameter validation failed: path or new name is empty`);
      return { error: 'Both path and newName are required.', newPath: '', success: false };
    }
    // Prevent path traversal or using invalid characters/names
    if (
      newName.includes('/') ||
      newName.includes('\\') ||
      newName === '.' ||
      newName === '..' ||
      /["*/:<>?\\|]/.test(newName) // Check for typical invalid filename characters
    ) {
      logger.error(`${logPrefix} New filename contains illegal characters: ${newName}`);
      return {
        error:
          'Invalid new name. It cannot contain path separators (/, \\), be "." or "..", or include characters like < > : " / \\ | ? *.',
        newPath: '',
        success: false,
      };
    }

    let newPath: string;
    try {
      const dir = path.dirname(currentPath);
      newPath = path.join(dir, newName);
      logger.debug(`${logPrefix} Calculated new path: ${newPath}`);

      // Check if paths are identical after calculation
      if (path.normalize(currentPath) === path.normalize(newPath)) {
        logger.info(
          `${logPrefix} Source path and calculated target path are identical, skipping rename`,
        );
        // Consider success as no change is needed, but maybe inform the user?
        // Return success for now.
        return { newPath, success: true };
      }
    } catch (error) {
      logger.error(`${logPrefix} Failed to calculate new path:`, error);
      return {
        error: `Internal error calculating the new path: ${(error as Error).message}`,
        newPath: '',
        success: false,
      };
    }

    // Perform the rename operation using rename directly
    try {
      await rename(currentPath, newPath);
      logger.info(`${logPrefix} Rename successful: ${currentPath} -> ${newPath}`);
      // Optionally return the newPath if frontend needs it
      // return { success: true, newPath: newPath };
      return { newPath, success: true };
    } catch (error) {
      logger.error(`${logPrefix} Rename failed:`, error);
      let errorMessage = (error as Error).message;
      // Provide more specific error messages based on common codes
      if ((error as any).code === 'ENOENT') {
        errorMessage = `File or directory not found at the original path: ${currentPath}.`;
      } else if ((error as any).code === 'EPERM' || (error as any).code === 'EACCES') {
        errorMessage = `Permission denied to rename the item at ${currentPath}. Check file/folder permissions.`;
      } else if ((error as any).code === 'EBUSY') {
        errorMessage = `The file or directory at ${currentPath} or ${newPath} is busy or locked by another process.`;
      } else if ((error as any).code === 'EISDIR' || (error as any).code === 'ENOTDIR') {
        errorMessage = `Cannot rename - conflict between file and directory. Source: ${currentPath}, Target: ${newPath}.`;
      } else if ((error as any).code === 'EEXIST') {
        // Target already exists
        errorMessage = `Cannot rename: an item with the name '${newName}' already exists at this location.`;
      }
      // Add more specific checks as needed
      return { error: errorMessage, newPath: '', success: false };
    }
  }

  @IpcMethod()
  async handleWriteFile({ path: filePath, content }: WriteLocalFileParams) {
    const logPrefix = `[Writing file ${filePath}]`;
    logger.debug(`${logPrefix} Starting to write file`, { contentLength: content?.length });

    // Validate parameters
    if (!filePath) {
      logger.error(`${logPrefix} Parameter validation failed: path is empty`);
      return { error: 'Path cannot be empty', success: false };
    }

    if (content === undefined) {
      logger.error(`${logPrefix} Parameter validation failed: content is empty`);
      return { error: 'Content cannot be empty', success: false };
    }

    try {
      // Ensure target directory exists (use async to avoid blocking main thread)
      const dirname = path.dirname(filePath);
      logger.debug(`${logPrefix} Creating directory: ${dirname}`);
      await mkdir(dirname, { recursive: true });

      // Write file content
      logger.debug(`${logPrefix} Starting to write content to file`);
      await writeFile(filePath, content, 'utf8');
      logger.info(`${logPrefix} File written successfully`, {
        path: filePath,
        size: content.length,
      });

      return { success: true };
    } catch (error) {
      logger.error(`${logPrefix} Failed to write file:`, error);
      return {
        error: `Failed to write file: ${(error as Error).message}`,
        success: false,
      };
    }
  }

  // ==================== Search & Find ====================

  /**
   * Handle IPC event for local file search
   */
  @IpcMethod()
  async handleLocalFilesSearch(params: LocalSearchFilesParams): Promise<FileResult[]> {
    logger.debug('Received file search request:', {
      directory: params.directory,
      keywords: params.keywords,
    });

    // Build search options from params, mapping directory to onlyIn
    const options: SearchOptions = {
      contentContains: params.contentContains,
      createdAfter: params.createdAfter ? new Date(params.createdAfter) : undefined,
      createdBefore: params.createdBefore ? new Date(params.createdBefore) : undefined,
      detailed: params.detailed,
      exclude: params.exclude,
      fileTypes: params.fileTypes,
      keywords: params.keywords,
      limit: params.limit || 30,
      liveUpdate: params.liveUpdate,
      modifiedAfter: params.modifiedAfter ? new Date(params.modifiedAfter) : undefined,
      modifiedBefore: params.modifiedBefore ? new Date(params.modifiedBefore) : undefined,
      onlyIn: params.directory, // Map directory param to onlyIn option
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
    };

    try {
      const results = await this.searchService.search(options.keywords, options);
      logger.debug('File search completed', {
        count: results.length,
        directory: params.directory,
      });
      return results;
    } catch (error) {
      logger.error('File search failed:', error);
      return [];
    }
  }

  @IpcMethod()
  async handleGrepContent(params: GrepContentParams): Promise<GrepContentResult> {
    return this.contentSearchService.grep(params);
  }

  @IpcMethod()
  async handleGlobFiles(params: GlobFilesParams): Promise<GlobFilesResult> {
    return this.searchService.glob(params);
  }

  // ==================== File Editing ====================

  @IpcMethod()
  async handleEditFile({
    file_path: filePath,
    new_string,
    old_string,
    replace_all = false,
  }: EditLocalFileParams): Promise<EditLocalFileResult> {
    const logPrefix = `[editFile: ${filePath}]`;
    logger.debug(`${logPrefix} Starting file edit`, { replace_all });

    try {
      // Read file content
      const content = await readFile(filePath, 'utf8');

      // Check if old_string exists
      if (!content.includes(old_string)) {
        logger.error(`${logPrefix} Old string not found in file`);
        return {
          error: 'The specified old_string was not found in the file',
          replacements: 0,
          success: false,
        };
      }

      // Perform replacement
      let newContent: string;
      let replacements: number;

      if (replace_all) {
        const regex = new RegExp(old_string.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&'), 'g');
        const matches = content.match(regex);
        replacements = matches ? matches.length : 0;
        newContent = content.replaceAll(old_string, new_string);
      } else {
        // Replace only first occurrence
        const index = content.indexOf(old_string);
        if (index === -1) {
          return {
            error: 'Old string not found',
            replacements: 0,
            success: false,
          };
        }
        newContent =
          content.slice(0, index) + new_string + content.slice(index + old_string.length);
        replacements = 1;
      }

      // Write back to file
      await writeFile(filePath, newContent, 'utf8');

      // Generate diff for UI display
      const patch = createPatch(filePath, content, newContent, '', '');
      const diffText = `diff --git a${filePath} b${filePath}\n${patch}`;

      // Calculate lines added and deleted from patch
      const patchLines = patch.split('\n');
      let linesAdded = 0;
      let linesDeleted = 0;

      for (const line of patchLines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          linesAdded++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          linesDeleted++;
        }
      }

      logger.info(`${logPrefix} File edited successfully`, {
        linesAdded,
        linesDeleted,
        replacements,
      });
      return {
        diffText,
        linesAdded,
        linesDeleted,
        replacements,
        success: true,
      };
    } catch (error) {
      logger.error(`${logPrefix} Edit failed:`, error);
      return {
        error: (error as Error).message,
        replacements: 0,
        success: false,
      };
    }
  }
}
