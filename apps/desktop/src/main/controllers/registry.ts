import type { CreateServicesResult, IpcServiceConstructor, MergeIpcService } from '@/utils/ipc';

import AuthCtr from './AuthCtr';
import BrowserWindowsCtr from './BrowserWindowsCtr';
import DevtoolsCtr from './DevtoolsCtr';
import LocalFileCtr from './LocalFileCtr';
import McpCtr from './McpCtr';
import McpInstallCtr from './McpInstallCtr';
import MenuController from './MenuCtr';
import NetworkProxyCtr from './NetworkProxyCtr';
import NotificationCtr from './NotificationCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import RemoteServerSyncCtr from './RemoteServerSyncCtr';
import ShellCommandCtr from './ShellCommandCtr';
import ShortcutController from './ShortcutCtr';
import SystemController from './SystemCtr';
import ToolDetectorCtr from './ToolDetectorCtr';
import TrayMenuCtr from './TrayMenuCtr';
import UpdaterCtr from './UpdaterCtr';
import UploadFileCtr from './UploadFileCtr';

export const controllerIpcConstructors = [
  AuthCtr,
  BrowserWindowsCtr,
  DevtoolsCtr,
  LocalFileCtr,
  McpCtr,
  McpInstallCtr,
  MenuController,
  NetworkProxyCtr,
  NotificationCtr,
  RemoteServerConfigCtr,
  RemoteServerSyncCtr,
  ShellCommandCtr,
  ShortcutController,
  SystemController,
  ToolDetectorCtr,
  TrayMenuCtr,
  UpdaterCtr,
  UploadFileCtr,
] as const satisfies readonly IpcServiceConstructor[];

type DesktopControllerIpcConstructors = typeof controllerIpcConstructors;
type DesktopControllerServices = CreateServicesResult<DesktopControllerIpcConstructors>;
export type DesktopIpcServices = MergeIpcService<DesktopControllerServices>;
