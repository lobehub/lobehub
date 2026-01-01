import { UploadFileParams } from '@lobechat/electron-client-ipc';

import FileService from '@/services/fileSrv';

import { ControllerModule, IpcMethod } from './index';

export default class UploadFileCtr extends ControllerModule {
  static override readonly groupName = 'upload';
  private get fileService() {
    return this.app.getService(FileService);
  }

  @IpcMethod()
  async uploadFile(params: UploadFileParams) {
    return this.fileService.uploadFile(params);
  }
}
