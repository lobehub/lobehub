import type { CreateServicesResult, IpcServiceConstructor, MergeIpcService } from '@/utils/ipc';

import AuthCtr from './AuthCtr';
import BrowserWindowsCtr from './BrowserWindowsCtr';
import CliCtr from './CliCtr';
import DevtoolsCtr from './DevtoolsCtr';
import GatewayConnectionCtr from './GatewayConnectionCtr';
import GitCtr from './GitCtr';
import HeterogeneousAgentCtr from './HeterogeneousAgentCtr';
import ImessageBridgeCtr from './ImessageBridgeCtr';
import LocalFileCtr from './LocalFileCtr';
import McpCtr from './McpCtr';
import McpInstallCtr from './McpInstallCtr';
import MenuController from './MenuCtr';
import NetworkProxyCtr from './NetworkProxyCtr';
import NotificationCtr from './NotificationCtr';
import OpenInAppCtr from './OpenInAppCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import RemoteServerSyncCtr from './RemoteServerSyncCtr';
import ScreenCaptureCtr from './ScreenCaptureCtr';
import ShellCommandCtr from './ShellCommandCtr';
import ShortcutController from './ShortcutCtr';
import SystemController from './SystemCtr';
import ToolDetectorCtr from './ToolDetectorCtr';
import TrayMenuCtr from './TrayMenuCtr';
import UpdaterCtr from './UpdaterCtr';
import WorkspaceCtr from './WorkspaceCtr';

export const controllerIpcConstructors = [
  HeterogeneousAgentCtr,
  AuthCtr,
  BrowserWindowsCtr,
  CliCtr,
  DevtoolsCtr,
  GatewayConnectionCtr,
  GitCtr,
  LocalFileCtr,
  ImessageBridgeCtr,
  McpCtr,
  McpInstallCtr,
  MenuController,
  NetworkProxyCtr,
  NotificationCtr,
  OpenInAppCtr,
  RemoteServerConfigCtr,
  RemoteServerSyncCtr,
  ScreenCaptureCtr,
  ShellCommandCtr,
  ShortcutController,
  SystemController,
  ToolDetectorCtr,
  TrayMenuCtr,
  UpdaterCtr,
  WorkspaceCtr,
] as const satisfies readonly IpcServiceConstructor[];

type DesktopControllerIpcConstructors = typeof controllerIpcConstructors;
type DesktopControllerServices = CreateServicesResult<DesktopControllerIpcConstructors>;
export type DesktopIpcServices = MergeIpcService<DesktopControllerServices>;
