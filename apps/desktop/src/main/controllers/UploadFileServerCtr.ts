import { CreateFileParams } from '@lobechat/electron-server-ipc';

import FileService from '@/services/fileSrv';

import { ControllerModule, IpcServerMethod } from './index';

export default class UploadFileServerCtr extends ControllerModule {
  static override readonly groupName = 'upload';

  private get fileService() {
    return this.app.getService(FileService);
  }

  @IpcServerMethod()
  async getFileUrlById(id: string) {
    return this.fileService.getFilePath(id);
  }

  @IpcServerMethod()
  async getFileHTTPURL(path: string) {
    return this.fileService.getFileHTTPURL(path);
  }

  @IpcServerMethod()
  async deleteFiles(paths: string[]) {
    return this.fileService.deleteFiles(paths);
  }

  @IpcServerMethod()
  async createFile(params: CreateFileParams) {
    return this.fileService.uploadFile(params);
  }
}
