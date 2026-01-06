import { type CreateFileParams, ElectronIpcClient, type FileMetadata } from '@lobechat/electron-server-ipc';
import type { DesktopServerIpcServices } from '@lobehub/desktop-ipc-typings';

import packageJSON from '@/../apps/desktop/package.json';

const createServerInvokeProxy = <IpcServices>(
  invoke: (channel: string, payload?: unknown) => Promise<unknown>,
): IpcServices =>
  new Proxy(
    {},
    {
      get(_target, groupKey) {
        if (typeof groupKey !== 'string') return undefined;

        return new Proxy(
          {},
          {
            get(_methodTarget, methodKey) {
              if (typeof methodKey !== 'string') return undefined;

              const channel = `${groupKey}.${methodKey}`;
              return (payload?: unknown) =>
                payload === undefined ? invoke(channel) : invoke(channel, payload);
            },
          },
        );
      },
    },
  ) as IpcServices;

class LobeHubElectronIpcClient extends ElectronIpcClient {
  private _services: DesktopServerIpcServices | null = null;

  private ensureServices(): DesktopServerIpcServices {
    if (this._services) return this._services;

    this._services = createServerInvokeProxy<DesktopServerIpcServices>((channel, payload) =>
      payload === undefined ? this.sendRequest(channel) : this.sendRequest(channel, payload),
    );

    return this.services;
  }

  private get ipc() {
    return this.ensureServices();
  }

  public get services(): DesktopServerIpcServices {
    return this.ipc;
  }

  getDatabasePath = async (): Promise<string> => {
    return this.ipc.system.getDatabasePath();
  };

  getUserDataPath = async (): Promise<string> => {
    return this.ipc.system.getUserDataPath();
  };

  getDatabaseSchemaHash = async () => {
    return this.ipc.system.getDatabaseSchemaHash();
  };

  setDatabaseSchemaHash = async (hash: string | undefined) => {
    if (!hash) return;

    return this.ipc.system.setDatabaseSchemaHash(hash);
  };

  getFilePathById = async (id: string) => {
    return this.ipc.upload.getFileUrlById(id);
  };

  getFileHTTPURL = async (path: string) => {
    return this.ipc.upload.getFileHTTPURL(path);
  };

  deleteFiles = async (paths: string[]) => {
    return this.ipc.upload.deleteFiles(paths);
  };

  createFile = async (params: CreateFileParams) => {
    return this.ipc.upload.createFile(params) as Promise<{
      metadata: FileMetadata;
      success: boolean;
    }>;
  };
}

export const electronIpcClient = new LobeHubElectronIpcClient(packageJSON.name);

export const ensureElectronServerIpc = (): DesktopServerIpcServices => electronIpcClient.services;
