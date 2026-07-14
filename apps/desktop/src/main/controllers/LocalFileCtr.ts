import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  defaultSearchProjectFiles,
  prepareSkillDirectory,
  type SkillDirectoryDeps,
} from '@lobechat/device-control';
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
  type LocalFilePreviewResult,
  type LocalFilePreviewUrlParams,
  type LocalFilePreviewUrlResult,
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
  type ProjectFileIndexEntry,
  type ProjectFileIndexParams,
  type ProjectFileIndexResult,
  type ProjectFileSearchParams,
  type ProjectFileSearchResult,
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
  expandTilde,
  type FileResult,
  listLocalFiles,
  moveLocalFiles,
  readLocalFile,
  renameLocalFile,
  resolveAgainstCwd,
  type SearchOptions,
  writeLocalFile,
} from '@lobechat/local-file-shell';
import { dialog, shell } from 'electron';
import { execa } from 'execa';

import ContentSearchService from '@/services/contentSearchSrv';
import FileSearchService from '@/services/fileSearchSrv';
import RemoteFileUploadService from '@/services/remoteFileUploadSrv';
import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';

import { ControllerModule, IpcMethod } from './index';

// Create logger
const logger = createLogger('controllers:LocalFileCtr');

const SAFE_PATH_PREFIXES = ['/tmp', '/var/tmp'] as const;
const PROJECT_FILE_GLOB_LIMIT = 5000;

/**
 * Image extensions `readFile` uploads to file storage instead of refusing as
 * binary. The agent then sees the image (vision) via an `image_url` part,
 * rather than hitting "Unsupported binary file".
 *
 * Limited to the formats vision providers accept (Anthropic/OpenAI:
 * png/jpeg/gif/webp) — anything else would be silently dropped by the
 * model-runtime builders, which is worse than the binary refusal. SVG is
 * intentionally absent: it's text, and reading the source is more useful to
 * the model than a rasterization we can't produce here.
 */
const LOCAL_IMAGE_EXT_TO_MIME: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Refuse to load image bytes beyond this size — providers reject them anyway. */
const MAX_IMAGE_READ_BYTES = 10 * 1024 * 1024;

const TEXT_PREVIEW_MIME_TYPES = new Set([
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/markdown',
  'application/toml',
  'application/xml',
  'application/yaml',
  'text/markdown',
  'text/mdx',
  'text/x-markdown',
]);

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

const toPosixRelativePath = (filePath: string) => filePath.split(path.sep).join('/');

const normalizeContentType = (contentType: string): string =>
  contentType.split(';')[0].trim().toLowerCase();

const isTextPreviewMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('text/') || TEXT_PREVIEW_MIME_TYPES.has(mimeType);

const serializePreviewFile = ({
  buffer,
  contentType,
}: {
  buffer: Buffer;
  contentType: string;
}): NonNullable<LocalFilePreviewResult['preview']> => {
  const normalizedContentType = normalizeContentType(contentType);

  if (normalizedContentType.startsWith('image/')) {
    return {
      base64: buffer.toString('base64'),
      contentType: normalizedContentType,
      type: 'image',
    };
  }

  if (isTextPreviewMimeType(normalizedContentType)) {
    return {
      content: buffer.toString('utf8'),
      contentType: normalizedContentType,
      type: 'text',
    };
  }

  if (normalizedContentType === 'application/pdf') {
    return { contentType: normalizedContentType, type: 'pdf' };
  }

  if (normalizedContentType.startsWith('video/')) {
    return { contentType: normalizedContentType, type: 'video' };
  }

  return { contentType: normalizedContentType, type: 'binary' };
};

const createProjectFileEntry = (
  root: string,
  absolutePath: string,
  isDirectory: boolean,
): ProjectFileIndexEntry => {
  const relativePath = toPosixRelativePath(path.relative(root, absolutePath));

  return {
    isDirectory,
    name: path.basename(absolutePath),
    path: absolutePath,
    relativePath: isDirectory ? `${relativePath}/` : relativePath,
  };
};

const collectProjectDirectories = (files: string[], root: string): ProjectFileIndexEntry[] => {
  const directories = new Set<string>();

  for (const filePath of files) {
    let current = path.dirname(filePath);
    while (current && current !== root && current.startsWith(`${root}${path.sep}`)) {
      if (directories.has(current)) break;
      directories.add(current);
      current = path.dirname(current);
    }
  }

  return [...directories].map((directory) => createProjectFileEntry(root, directory, true));
};

const createDetectedProjectFileEntry = async (
  root: string,
  absolutePath: string,
): Promise<ProjectFileIndexEntry> => {
  try {
    const stats = await stat(absolutePath);
    return createProjectFileEntry(root, absolutePath, stats.isDirectory());
  } catch {
    return createProjectFileEntry(root, absolutePath, false);
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
    const resolvedPath = expandTilde(filePath) ?? filePath;
    logger.debug('Attempting to open file:', { filePath: resolvedPath });

    try {
      await shell.openPath(resolvedPath);
      logger.debug('File opened successfully:', { filePath: resolvedPath });
      return { success: true };
    } catch (error) {
      logger.error(`Failed to open file ${resolvedPath}:`, error);
      return { error: (error as Error).message, success: false };
    }
  }

  @IpcMethod()
  async handleOpenLocalFolder({ path: targetPath, isDirectory }: OpenLocalFolderParams): Promise<{
    error?: string;
    success: boolean;
  }> {
    const resolvedTarget = expandTilde(targetPath) ?? targetPath;
    const folderPath = isDirectory ? resolvedTarget : path.dirname(resolvedTarget);
    logger.debug('Attempting to open folder:', {
      folderPath,
      isDirectory,
      targetPath: resolvedTarget,
    });

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
  async readFiles({ paths, cwd }: LocalReadFilesParams): Promise<LocalReadFileResult[]> {
    logger.debug('Starting batch file reading:', { count: paths.length });

    const results: LocalReadFileResult[] = [];

    for (const filePath of paths) {
      logger.debug('Reading single file:', { filePath });
      const result = await readLocalFile({ cwd, path: filePath });
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

    // Image files: `local-file-shell` refuses binary, and the agent should be
    // able to actually *see* the image (vision) rather than hit "Unsupported
    // binary file type". Delegate the upload to the embedded CLI
    // (`lh file upload`) and return a durable { fileId, url } — bytes never
    // cross IPC and never reach the DB; the MessageContent processor turns
    // the uploaded URL into an `image_url` part for the LLM.
    const ext = path.extname(params.path).toLowerCase().replace('.', '');
    const imageMimeType = LOCAL_IMAGE_EXT_TO_MIME[ext];
    if (imageMimeType) {
      const filePath = resolveAgainstCwd(params.path, params.cwd) ?? params.path;
      const filename = path.basename(filePath);

      const buildImageResult = (
        content: string,
        extra: Partial<LocalReadFileResult> = {},
      ): LocalReadFileResult => ({
        charCount: 0,
        content,
        createdTime: new Date(),
        fileType: imageMimeType,
        filename,
        isImage: true,
        lineCount: 0,
        loc: [0, 0],
        modifiedTime: new Date(),
        totalCharCount: 0,
        totalLineCount: 0,
        ...extra,
      });

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch (error) {
        return buildImageResult(`Error accessing or processing file: ${(error as Error).message}`);
      }

      if (!fileStat.isFile()) {
        return buildImageResult(`Error: Not a regular file: ${filePath}`);
      }

      if (fileStat.size > MAX_IMAGE_READ_BYTES) {
        return buildImageResult(
          `Error: Image file is too large to preview (${fileStat.size} bytes, limit ${MAX_IMAGE_READ_BYTES}).`,
        );
      }

      try {
        const record = await this.app.getService(RemoteFileUploadService).uploadLocalFile(filePath);

        if (record?.url) {
          return buildImageResult(`[Image: ${filename}]`, {
            createdTime: fileStat.birthtime,
            imageFileId: record.id,
            imageUrl: record.url,
            modifiedTime: fileStat.mtime,
          });
        }

        logger.warn('Image upload returned no record:', { filePath });
      } catch (error) {
        logger.warn('Image upload failed:', { error, filePath });
      }

      // Degrade: the placeholder tells the model an image exists that it
      // cannot inspect, instead of failing the read outright.
      return buildImageResult(
        `[Image: ${filename}] (upload unavailable — the model cannot view this image)`,
        { createdTime: fileStat.birthtime, modifiedTime: fileStat.mtime },
      );
    }

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
  async handleMoveFiles({ items, cwd }: MoveLocalFilesParams): Promise<LocalMoveFilesResultItem[]> {
    logger.debug('Starting batch file move:', { itemsCount: items?.length });
    return moveLocalFiles({ cwd, items });
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
  async handleWriteFile({ path: filePath, content, cwd }: WriteLocalFileParams) {
    logger.debug(`Writing file ${filePath}`, { contentLength: content?.length });
    return writeLocalFile({ content, cwd, path: filePath });
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
  async getLocalFilePreviewUrl({
    accept,
    allowExternalFile,
    path: filePath,
    workingDirectory,
  }: LocalFilePreviewUrlParams): Promise<LocalFilePreviewUrlResult> {
    try {
      const url = await this.app.localFileProtocolManager.createPreviewUrl({
        accept,
        allowExternalFile,
        filePath,
        workspaceRoot: workingDirectory,
      });

      if (!url) {
        return { error: 'File is outside the approved workspace', success: false };
      }

      return { success: true, url };
    } catch (error) {
      logger.error('Failed to create local file preview URL:', error);
      return { error: (error as Error).message, success: false };
    }
  }

  @IpcMethod()
  async getLocalFilePreview({
    accept,
    allowExternalFile,
    path: filePath,
    workingDirectory,
  }: LocalFilePreviewUrlParams): Promise<LocalFilePreviewResult> {
    try {
      const preview = await this.app.localFileProtocolManager.readPreviewFile({
        accept,
        allowExternalFile,
        filePath,
        workspaceRoot: workingDirectory,
      });

      if (!preview) {
        return { error: 'File is outside the approved workspace', success: false };
      }

      return {
        preview: serializePreviewFile(preview),
        success: true,
      };
    } catch (error) {
      logger.error('Failed to read local file preview:', error);
      return { error: (error as Error).message, success: false };
    }
  }

  /**
   * Host deps for the shared skill-archive cache: this keeps the renderer-IPC
   * path (here) and the gateway RPC path (`GatewayConnectionCtr` →
   * `@lobechat/device-control`) on ONE cache directory and one proxy-aware
   * fetch, so a skill prepared by either entry point is a cache hit for the
   * other.
   */
  getSkillDirectoryDeps(): SkillDirectoryDeps {
    return {
      fetchSkillArchive: netFetch,
      skillCacheRoot: path.join(this.app.appStoragePath, 'file-storage', 'skills'),
    };
  }

  @IpcMethod()
  async handlePrepareSkillDirectory(
    params: PrepareSkillDirectoryParams,
  ): Promise<PrepareSkillDirectoryResult> {
    return prepareSkillDirectory(params, this.getSkillDirectoryDeps());
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

  @IpcMethod()
  async getProjectFileIndex(params: ProjectFileIndexParams = {}): Promise<ProjectFileIndexResult> {
    const requestedScope = params.scope || process.cwd();
    const startedAt = Date.now();

    try {
      const rootResult = await execa(
        'git',
        ['-C', requestedScope, 'rev-parse', '--show-toplevel'],
        {
          reject: false,
          timeout: 5000,
        },
      );
      const root = rootResult.exitCode === 0 ? rootResult.stdout.trim() : requestedScope;

      if (rootResult.exitCode === 0) {
        const [trackedResult, untrackedResult] = await Promise.all([
          execa(
            'git',
            ['-C', root, '-c', 'core.quotepath=false', 'ls-files', '--recurse-submodules'],
            {
              reject: false,
              timeout: 10_000,
            },
          ),
          execa(
            'git',
            [
              '-C',
              root,
              '-c',
              'core.quotepath=false',
              'ls-files',
              '--others',
              '--exclude-standard',
            ],
            { reject: false, timeout: 10_000 },
          ),
        ]);

        if (trackedResult.exitCode !== 0) {
          throw new Error(trackedResult.stderr || 'git ls-files failed');
        }

        const files = [
          ...trackedResult.stdout.split('\n'),
          ...(untrackedResult.exitCode === 0 ? untrackedResult.stdout.split('\n') : []),
        ]
          .map((item) => item.trim())
          .filter(Boolean)
          .map((relativePath) => path.resolve(root, relativePath));

        const seen = new Set<string>();
        const fileEntries = files
          .filter((filePath) => {
            if (seen.has(filePath)) return false;
            seen.add(filePath);
            return true;
          })
          .map((filePath) => createProjectFileEntry(root, filePath, false));

        const entries = [...collectProjectDirectories(files, root), ...fileEntries];
        logger.debug('Project file index built from git', {
          duration: Date.now() - startedAt,
          entries: entries.length,
          files: fileEntries.length,
          requestedScope,
          root,
        });
        await this.approveProjectRootForPreview(root);

        return {
          entries,
          indexedAt: new Date().toISOString(),
          root,
          source: 'git',
        };
      }
    } catch (error) {
      logger.debug('Git project file index failed, falling back to glob', {
        error,
        requestedScope,
      });
    }

    const fallback = await this.searchService.glob({
      limit: PROJECT_FILE_GLOB_LIMIT,
      pattern: '**/*',
      scope: requestedScope,
    });
    const files = fallback.files.map((filePath) => path.resolve(filePath));
    const entries = await Promise.all(
      files.map((filePath) => createDetectedProjectFileEntry(requestedScope, filePath)),
    );

    logger.debug('Project file index built from glob', {
      duration: Date.now() - startedAt,
      entries: entries.length,
      engine: fallback.engine,
      requestedScope,
    });
    await this.approveProjectRootForPreview(requestedScope);

    return {
      entries,
      indexedAt: new Date().toISOString(),
      root: requestedScope,
      source: 'glob',
    };
  }

  @IpcMethod()
  async searchProjectFiles(params: ProjectFileSearchParams): Promise<ProjectFileSearchResult> {
    const startedAt = Date.now();
    const result = await defaultSearchProjectFiles(params);

    logger.debug('Project file search completed', {
      duration: Date.now() - startedAt,
      entries: result.entries.length,
      query: params.query,
      requestedScope: params.scope,
      root: result.root,
      source: result.source,
    });
    await this.approveProjectRootForPreview(result.root);

    return result;
  }

  /**
   * Handle IPC event for local file search
   */
  @IpcMethod()
  async handleLocalFilesSearch(params: LocalSearchFilesParams): Promise<FileResult[]> {
    const effectiveDirectory = expandTilde(params.directory ?? params.scope);

    logger.debug('Received file search request:', {
      directory: params.directory,
      effectiveDirectory,
      limit: params.limit,
      keywords: params.keywords,
      scope: params.scope,
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
      onlyIn: effectiveDirectory,
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
    };

    try {
      const results = await this.searchService.search(options.keywords, options);
      logger.debug('File search completed', {
        count: results.length,
        directory: params.directory,
        effectiveDirectory,
        results: results.slice(0, 5).map((result) => ({
          engine: result.engine,
          isDirectory: result.isDirectory,
          name: result.name,
          path: result.path,
        })),
        scope: params.scope,
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

  private async approveProjectRootForPreview(root: string) {
    try {
      await this.app.localFileProtocolManager.approveIndexedProjectRoot(root);
    } catch (error) {
      logger.error(`Failed to approve project preview root ${root}:`, error);
    }
  }
}
