import {
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
  type LocalFileItem,
  type LocalMoveFilesResultItem,
  type LocalReadFileParams,
  type LocalReadFileResult,
  type LocalReadFilesParams,
  type LocalSearchFilesParams,
  type MoveLocalFilesParams,
  type OpenLocalFileParams,
  type OpenLocalFolderParams,
  type RenameLocalFileParams,
  type RunCommandParams,
  type RunCommandResult,
  type ShowSaveDialogParams,
  type ShowSaveDialogResult,
  type WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

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
