import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type AuditSafePathsParams,
  type AuditSafePathsResult,
  type EditLocalFileParams,
  type EditLocalFileResult,
  type GlobFilesParams,
  type GlobFilesResult,
  type GrepContentParams,
  type GrepContentResult,
  type ListLocalFileParams,
  type LocalMoveFilesResultItem,
  type LocalReadFileParams,
  type LocalReadFileResult,
  type LocalReadFilesParams,
  type LocalSearchFilesParams,
  type MoveLocalFilesParams,
  type OpenLocalFileParams,
  type OpenLocalFolderParams,
  type PickFileParams,
  type PickFileResult,
  type PrepareSkillDirectoryParams,
  type PrepareSkillDirectoryResult,
  type RenameLocalFileResult,
  type ResolveSkillResourcePathParams,
  type ResolveSkillResourcePathResult,
  type ShowOpenDialogParams,
  type ShowOpenDialogResult,
  type ShowSaveDialogParams,
  type ShowSaveDialogResult,
  type WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import {
  editLocalFile,
  listLocalFiles,
  moveLocalFiles,
  readLocalFile,
  renameLocalFile,
  writeLocalFile,
} from '@lobechat/local-file-shell';
import { dialog, shell } from 'electron';
import { unzipSync } from 'fflate';

import { type FileResult, type SearchOptions } from '@/modules/fileSearch';
import ContentSearchService from '@/services/contentSearchSrv';
import FileSearchService from '@/services/fileSearchSrv';
import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';

import { ControllerModule, IpcMethod } from './index';

// Create logger
const logger = createLogger('controllers:LocalFileCtr');

const SAFE_PATH_PREFIXES = ['/tmp', '/var/tmp'] as const;

const normalizeAbsolutePath = (inputPath: string): string =>
  path.normalize(path.isAbsolute(inputPath) ? inputPath : `/${inputPath}`);

const resolvePathWithScope = (inputPath: string, scope: string): string =>
  path.isAbsolute(inputPath) ? inputPath : path.join(scope, inputPath);

const isWithinSafePathPrefixes = (targetPath: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => targetPath === prefix || targetPath.startsWith(`${prefix}${path.sep}`));

const resolveNearestExistingRealPath = async (targetPath: string): Promise<string | undefined> => {
  let currentPath = targetPath;

  while (true) {
    try {
      await access(currentPath, constants.F_OK);
      return normalizeAbsolutePath(await realpath(currentPath));
    } catch {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) return undefined;
      currentPath = parentPath;
    }
  }
};

const resolveSafePathRealPrefixes = async (): Promise<string[]> => {
  const prefixes = new Set<string>(SAFE_PATH_PREFIXES);

  for (const safePrefix of SAFE_PATH_PREFIXES) {
    try {
      prefixes.add(normalizeAbsolutePath(await realpath(safePrefix)));
    } catch {
      // Keep the lexical prefix if the platform does not expose this directory.
    }
  }

  return [...prefixes];
};

const areAllPathsSafeOnDisk = async (
  paths: string[],
  resolveAgainstScope: string,
): Promise<boolean> => {
  if (paths.length === 0) return false;

  const safeRealPrefixes = await resolveSafePathRealPrefixes();

  for (const currentPath of paths) {
    const normalizedPath = normalizeAbsolutePath(
      resolvePathWithScope(currentPath, resolveAgainstScope),
    );

    if (!isWithinSafePathPrefixes(normalizedPath, SAFE_PATH_PREFIXES)) {
      return false;
    }

    const realPath = await resolveNearestExistingRealPath(normalizedPath);
    if (!realPath || !isWithinSafePathPrefixes(realPath, safeRealPrefixes)) {
      return false;
    }
  }

  return true;
};

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
  async handleShowOpenDialog({
    filters,
    multiple,
    title,
  }: ShowOpenDialogParams): Promise<ShowOpenDialogResult> {
    logger.debug('Showing open dialog:', { filters, multiple, title });

    const result = await dialog.showOpenDialog({
      filters,
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      title,
    });

    logger.debug('Open dialog result:', { canceled: result.canceled, filePaths: result.filePaths });

    return {
      canceled: result.canceled,
      filePaths: result.filePaths,
    };
  }

  @IpcMethod()
  async handlePickFile({ filters, title }: PickFileParams): Promise<PickFileResult> {
    logger.debug('Picking file:', { filters, title });

    const result = await dialog.showOpenDialog({
      filters,
      properties: ['openFile'],
      title,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const data = await readFile(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);

    const MIME_MAP: Record<string, string> = {
      avif: 'image/avif',
      gif: 'image/gif',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      png: 'image/png',
      svg: 'image/svg+xml',
      webp: 'image/webp',
    };

    return {
      canceled: false,
      file: {
        data: new Uint8Array(data),
        mimeType: MIME_MAP[ext] || 'application/octet-stream',
        name,
      },
    };
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
      logger.debug('Reading single file:', { filePath });
      const result = await readLocalFile({ path: filePath });
      results.push(result);
    }

    logger.debug('Batch file reading completed', { count: results.length });
    return results;
  }

  @IpcMethod()
  async readFile(params: LocalReadFileParams): Promise<LocalReadFileResult> {
    logger.debug('Starting to read file:', {
      filePath: params.path,
      fullContent: params.fullContent,
      loc: params.loc,
    });
    return readLocalFile(params);
  }

  @IpcMethod()
  async listLocalFiles(
    params: ListLocalFileParams,
  ): Promise<{ files: FileResult[]; totalCount: number }> {
    logger.debug('Listing directory contents:', params);
    return listLocalFiles(params) as any;
  }

  @IpcMethod()
  async handleMoveFiles({ items }: MoveLocalFilesParams): Promise<LocalMoveFilesResultItem[]> {
    logger.debug('Starting batch file move:', { itemsCount: items?.length });
    return moveLocalFiles({ items });
  }

  @IpcMethod()
  async handleRenameFile({
    path: currentPath,
    newName,
  }: {
    newName: string;
    path: string;
  }): Promise<RenameLocalFileResult> {
    logger.debug(`Renaming ${currentPath} -> ${newName}`);
    return renameLocalFile({ newName, path: currentPath });
  }

  @IpcMethod()
  async handleWriteFile({ path: filePath, content }: WriteLocalFileParams) {
    logger.debug(`Writing file ${filePath}`, { contentLength: content?.length });
    return writeLocalFile({ content, path: filePath });
  }

  @IpcMethod()
  async auditSafePaths({
    paths,
    resolveAgainstScope,
  }: AuditSafePathsParams): Promise<AuditSafePathsResult> {
    logger.debug('Auditing safe paths', { count: paths.length, resolveAgainstScope });

    return {
      allSafe: await areAllPathsSafeOnDisk(paths, resolveAgainstScope),
    };
  }

  @IpcMethod()
  async handlePrepareSkillDirectory({
    forceRefresh,
    url,
    zipHash,
  }: PrepareSkillDirectoryParams): Promise<PrepareSkillDirectoryResult> {
    const cacheRoot = path.join(this.app.appStoragePath, 'file-storage', 'skills');
    const extractedDir = path.join(cacheRoot, 'extracted', zipHash);
    const markerPath = path.join(extractedDir, '.prepared');
    const zipPath = path.join(cacheRoot, 'archives', `${zipHash}.zip`);

    try {
      if (!forceRefresh) {
        await access(markerPath, constants.F_OK);
        return { extractedDir, success: true, zipPath };
      }
    } catch {
      // Cache miss, continue preparing the local copy.
    }

    try {
      const response = await netFetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to download skill package: ${response.status} ${response.statusText}`,
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const extractedFiles = unzipSync(new Uint8Array(buffer));

      await rm(extractedDir, { force: true, recursive: true });
      await mkdir(path.dirname(zipPath), { recursive: true });
      await mkdir(extractedDir, { recursive: true });
      await writeFile(zipPath, buffer);

      for (const [relativePath, fileContent] of Object.entries(extractedFiles)) {
        if (relativePath.endsWith('/')) continue;

        const targetPath = path.resolve(extractedDir, relativePath);
        const normalizedRoot = `${path.resolve(extractedDir)}${path.sep}`;
        if (targetPath !== path.resolve(extractedDir) && !targetPath.startsWith(normalizedRoot)) {
          throw new Error(`Unsafe file path in skill archive: ${relativePath}`);
        }

        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, Buffer.from(fileContent as Uint8Array));
      }

      await writeFile(markerPath, JSON.stringify({ preparedAt: Date.now(), url, zipHash }), 'utf8');

      return { extractedDir, success: true, zipPath };
    } catch (error) {
      return {
        error: (error as Error).message,
        extractedDir,
        success: false,
        zipPath,
      };
    }
  }

  @IpcMethod()
  async handleResolveSkillResourcePath({
    path: resourcePath,
    url,
    zipHash,
  }: ResolveSkillResourcePathParams): Promise<ResolveSkillResourcePathResult> {
    const prepared = await this.handlePrepareSkillDirectory({ url, zipHash });

    if (!prepared.success) {
      return { error: prepared.error, success: false };
    }

    const normalizedRoot = path.resolve(prepared.extractedDir);
    const fullPath = path.resolve(normalizedRoot, resourcePath);

    if (fullPath !== normalizedRoot && !fullPath.startsWith(`${normalizedRoot}${path.sep}`)) {
      return {
        error: `Unsafe skill resource path: ${resourcePath}`,
        success: false,
      };
    }

    return {
      fullPath,
      success: true,
    };
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
  async handleEditFile(params: EditLocalFileParams): Promise<EditLocalFileResult> {
    logger.debug(`Editing file ${params.file_path}`, { replace_all: params.replace_all });
    return editLocalFile(params);
  }
}
