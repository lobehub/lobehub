import { MARKDOWN_MIME_TYPES } from '@lobechat/const';
import {
  type AuditSafePathsParams,
  type AuditSafePathsResult,
  type EditLocalFileParams,
  type EditLocalFileResult,
  type GetCommandOutputParams,
  type GetCommandOutputResult,
  type GlobFilesParams,
  type GlobFilesResult,
  type GrepContentParams,
  type GrepContentResult,
  type KillCommandParams,
  type KillCommandResult,
  type ListLocalFileParams,
  type ListLocalFilesResult,
  type ListProjectSkillsParams,
  type ListProjectSkillsResult,
  type LocalFileItem,
  type LocalFilePreviewUrlParams,
  type LocalMoveFilesResultItem,
  type LocalReadFileParams,
  type LocalReadFileResult,
  type LocalReadFilesParams,
  type LocalSearchFilesParams,
  type MoveLocalFilesParams,
  type OpenLocalFileParams,
  type OpenLocalFolderParams,
  type PrepareSkillDirectoryParams,
  type PrepareSkillDirectoryResult,
  type ProjectFileIndexParams,
  type ProjectFileIndexResult,
  type ProjectFileSearchParams,
  type ProjectFileSearchResult,
  type RenameLocalFileParams,
  type ResolveSkillResourcePathParams,
  type ResolveSkillResourcePathResult,
  type RunCommandParams,
  type RunCommandResult,
  type ShowSaveDialogParams,
  type ShowSaveDialogResult,
  type WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

const TEXT_PREVIEW_MIME_TYPES = new Set([
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/markdown',
  'application/toml',
  'application/xml',
  'application/yaml',
  ...MARKDOWN_MIME_TYPES,
]);

export interface BinaryLocalFilePreview {
  contentType: string;
  type: 'binary' | 'pdf' | 'video';
}

export interface ImageLocalFilePreview {
  blob: Blob;
  contentType: string;
  type: 'image';
}

export interface TextLocalFilePreview {
  content: string;
  contentType: string;
  type: 'text';
}

export type LocalFilePreview =
  | BinaryLocalFilePreview
  | ImageLocalFilePreview
  | TextLocalFilePreview;

const normalizeContentType = (contentType: string | null): string =>
  contentType?.split(';')[0].trim().toLowerCase() ?? '';

const isTextPreviewMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('text/') || TEXT_PREVIEW_MIME_TYPES.has(mimeType);

const fetchLocalFilePreview = async (
  url: string,
  accept?: LocalFilePreviewUrlParams['accept'],
): Promise<LocalFilePreview> => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load local file: ${response.status}`);
  }

  const contentType = normalizeContentType(response.headers.get('content-type'));

  if (contentType.startsWith('image/')) {
    return { blob: await response.blob(), contentType, type: 'image' };
  }

  if (accept === 'image') {
    throw new Error('Unsupported local file preview type');
  }

  if (isTextPreviewMimeType(contentType)) {
    return { content: await response.text(), contentType, type: 'text' };
  }

  if (contentType === 'application/pdf') {
    return { contentType, type: 'pdf' };
  }

  if (contentType.startsWith('video/')) {
    return { contentType, type: 'video' };
  }

  return { contentType, type: 'binary' };
};

class LocalFileService {
  // File Operations
  async listLocalFiles(params: ListLocalFileParams): Promise<ListLocalFilesResult> {
    return ensureElectronIpc().localSystem.listLocalFiles(params);
  }

  async readLocalFile(params: LocalReadFileParams): Promise<LocalReadFileResult> {
    return ensureElectronIpc().localSystem.readFile(params);
  }

  async readLocalFiles(params: LocalReadFilesParams): Promise<LocalReadFileResult[]> {
    return ensureElectronIpc().localSystem.readFiles(params);
  }

  async searchLocalFiles(params: LocalSearchFilesParams): Promise<LocalFileItem[]> {
    return ensureElectronIpc().localSystem.handleLocalFilesSearch(params);
  }

  async getProjectFileIndex(params: ProjectFileIndexParams): Promise<ProjectFileIndexResult> {
    return ensureElectronIpc().localSystem.getProjectFileIndex(params);
  }

  async searchProjectFiles(params: ProjectFileSearchParams): Promise<ProjectFileSearchResult> {
    return ensureElectronIpc().localSystem.searchProjectFiles(params);
  }

  async listProjectSkills(params: ListProjectSkillsParams): Promise<ListProjectSkillsResult> {
    // Project-skill scanning lives in the main-process WorkspaceCtr ('workspace'
    // group), split out of LocalFileCtr — hence the namespace differs from the
    // other local-file ops here.
    return ensureElectronIpc().workspace.listProjectSkills(params);
  }

  async openLocalFile(params: OpenLocalFileParams) {
    return ensureElectronIpc().localSystem.handleOpenLocalFile(params);
  }

  async openLocalFolder(params: OpenLocalFolderParams) {
    return ensureElectronIpc().localSystem.handleOpenLocalFolder(params);
  }

  async moveLocalFiles(params: MoveLocalFilesParams): Promise<LocalMoveFilesResultItem[]> {
    return ensureElectronIpc().localSystem.handleMoveFiles(params);
  }

  async renameLocalFile(params: RenameLocalFileParams) {
    return ensureElectronIpc().localSystem.handleRenameFile(params);
  }

  async writeFile(params: WriteLocalFileParams) {
    return ensureElectronIpc().localSystem.handleWriteFile(params);
  }

  async auditSafePaths(params: AuditSafePathsParams): Promise<AuditSafePathsResult> {
    return ensureElectronIpc().localSystem.auditSafePaths(params);
  }

  async getLocalFilePreview(params: LocalFilePreviewUrlParams): Promise<LocalFilePreview> {
    const result = await ensureElectronIpc().localSystem.getLocalFilePreviewUrl(params);

    if (!result.success || !result.url) {
      throw new Error(result.error || 'Missing local file preview URL');
    }

    return fetchLocalFilePreview(result.url, params.accept);
  }

  async prepareSkillDirectory(
    params: PrepareSkillDirectoryParams,
  ): Promise<PrepareSkillDirectoryResult> {
    return ensureElectronIpc().localSystem.handlePrepareSkillDirectory(params);
  }

  async resolveSkillResourcePath(
    params: ResolveSkillResourcePathParams,
  ): Promise<ResolveSkillResourcePathResult> {
    return ensureElectronIpc().localSystem.handleResolveSkillResourcePath(params);
  }

  async editLocalFile(params: EditLocalFileParams): Promise<EditLocalFileResult> {
    return ensureElectronIpc().localSystem.handleEditFile(params);
  }

  // Shell Commands
  async runCommand(params: RunCommandParams): Promise<RunCommandResult> {
    return ensureElectronIpc().shellCommand.handleRunCommand(params);
  }

  async getCommandOutput(params: GetCommandOutputParams): Promise<GetCommandOutputResult> {
    return ensureElectronIpc().shellCommand.handleGetCommandOutput(params);
  }

  async killCommand(params: KillCommandParams): Promise<KillCommandResult> {
    return ensureElectronIpc().shellCommand.handleKillCommand(params);
  }

  // Search & Find
  async grepContent(params: GrepContentParams): Promise<GrepContentResult> {
    return ensureElectronIpc().localSystem.handleGrepContent(params);
  }

  async globFiles(params: GlobFilesParams): Promise<GlobFilesResult> {
    return ensureElectronIpc().localSystem.handleGlobFiles(params);
  }

  // Dialog
  async showSaveDialog(params: ShowSaveDialogParams): Promise<ShowSaveDialogResult> {
    return ensureElectronIpc().localSystem.handleShowSaveDialog(params);
  }

  // Helper methods
  async openLocalFileOrFolder(path: string, isDirectory: boolean) {
    if (isDirectory) {
      return this.openLocalFolder({ isDirectory, path });
    } else {
      return this.openLocalFile({ path });
    }
  }

  async openFileFolder(path: string) {
    return this.openLocalFolder({ isDirectory: false, path });
  }
}

export const localFileService = new LocalFileService();
