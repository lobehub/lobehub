import type { DeviceControlDeps } from '@lobechat/device-control';
import { app as electronApp } from 'electron';

import type { App } from '@/core/App';
import { getRemoteTerminalDeps } from '@/modules/terminal/remote';
import { updaterConfig } from '@/modules/updater/configs';
import { createRemoteAppUpdateDeps } from '@/modules/updater/remoteUpdate';
import GatewayConnectionService from '@/services/gatewayConnectionSrv';
import { createLogger } from '@/utils/logger';

import HeterogeneousAgentCtr from './HeterogeneousAgentCtr';
import LocalFileCtr from './LocalFileCtr';
import McpCtr from './McpCtr';

const logger = createLogger('controllers:GatewayConnectionCtr');

/**
 * Desktop handlers for the shared `@lobechat/device-control` dispatcher, the
 * device RPCs a server sends this machine through the device gateway. Each
 * handler looks its controller up when it runs.
 */
export const createDesktopDeviceControlDeps = (app: App): DeviceControlDeps => {
  const localFileCtr = () => app.getController(LocalFileCtr);
  const service = () => app.getService(GatewayConnectionService);

  return {
    approveProjectRoot: async (root) => {
      try {
        await app.localFileProtocolManager.approveIndexedProjectRoot(root);
      } catch (error) {
        logger.error(`Failed to approve project preview root ${root}:`, error);
      }
    },
    // Workspace share (server-driven enroll/unenroll RPCs): the service owns
    // the gateway connections, so both handlers route straight to it.
    enrollWorkspace: (params) => service().enrollWorkspace(params),
    getLocalFilePreview: (params) => localFileCtr().getLocalFilePreview(params),
    readExternalAssetForPublish: (params) => localFileCtr().readExternalAssetForPublish(params),
    copyAssetForPublish: (params) => localFileCtr().copyAssetForPublish(params),
    getProjectFileIndex: (params) => localFileCtr().getProjectFileIndex(params),
    listHeterogeneousAgentModels: (params) =>
      app.getController(HeterogeneousAgentCtr).listModels(params),
    // A server that can't reach an MCP server itself lists its tools here
    listMcpTools: (params) => app.getController(McpCtr).listToolsForGateway(params),
    searchProjectFiles: (params) => localFileCtr().searchProjectFiles(params),
    // Remote "delete" goes to this machine's trash (`shell.trashItem`), same
    // as the local Files tree, so it stays recoverable.
    trashLocalFiles: (params) => localFileCtr().trashLocalFiles(params),
    unenrollWorkspace: (params) => service().unenrollWorkspace(params),
    // Skill-archive cache (`prepareSkillDirectory` RPC): reuse LocalFileCtr's
    // deps so gateway-prepared skills share one cache with the renderer-IPC path.
    ...localFileCtr().getSkillDirectoryDeps(),
    // Remote app update from the web device page, over the same updater the
    // local "Check for updates" menu drives.
    ...createRemoteAppUpdateDeps({
      currentVersion: electronApp.getVersion(),
      enabled: updaterConfig.enableAppUpdate,
      getUpdater: () => app.getUpdaterManager(),
    }),
    ...getRemoteTerminalDeps(),
  };
};
