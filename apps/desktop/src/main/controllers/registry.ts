import type { CreateServicesResult, IpcServiceConstructor, MergeIpcService } from '@/utils/ipc';

import AuthCtr from './AuthCtr';
import BinaryCtr from './BinaryCtr';
import BrowserControlCtr from './BrowserControlCtr';
import BrowserSidebarCtr from './BrowserSidebarCtr';
import BrowserWindowsCtr from './BrowserWindowsCtr';
import CliCtr from './CliCtr';
import DevtoolsCtr from './DevtoolsCtr';
import GatewayConnectionCtr from './GatewayConnectionCtr';
import GitCtr from './GitCtr';
import HeterogeneousAgentCtr from './HeterogeneousAgentCtr';
import ImessageBridgeCtr from './ImessageBridgeCtr';
import LocalDatabaseCtr from './LocalDatabaseCtr';
import LocalFileCtr from './LocalFileCtr';
import McpCtr from './McpCtr';
import McpInstallCtr from './McpInstallCtr';
import MenuController from './MenuCtr';
import NetworkProxyCtr from './NetworkProxyCtr';
import NotificationCtr from './NotificationCtr';
import OpenInAppCtr from './OpenInAppCtr';
import ProviderImportCtr from './ProviderImportCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import RemoteServerSyncCtr from './RemoteServerSyncCtr';
import RendererOtaCtr from './RendererOtaCtr';
import ScreenCaptureCtr from './ScreenCaptureCtr';
import ShellCommandCtr from './ShellCommandCtr';
import ShortcutController from './ShortcutCtr';
import SystemController from './SystemCtr';
import TerminalCtr from './TerminalCtr';
import TrayMenuCtr from './TrayMenuCtr';
import UpdaterCtr from './UpdaterCtr';
import WorkspaceCtr from './WorkspaceCtr';

export const controllerIpcConstructors = [
  HeterogeneousAgentCtr,
  AuthCtr,
  BrowserControlCtr,
  BrowserSidebarCtr,
  BrowserWindowsCtr,
  CliCtr,
  DevtoolsCtr,
  GatewayConnectionCtr,
  GitCtr,
  LocalDatabaseCtr,
  LocalFileCtr,
  ImessageBridgeCtr,
  McpCtr,
  McpInstallCtr,
  MenuController,
  NetworkProxyCtr,
  NotificationCtr,
  RendererOtaCtr,
  OpenInAppCtr,
  ProviderImportCtr,
  RemoteServerConfigCtr,
  RemoteServerSyncCtr,
  ScreenCaptureCtr,
  ShellCommandCtr,
  ShortcutController,
  SystemController,
  TerminalCtr,
  BinaryCtr,
  TrayMenuCtr,
  UpdaterCtr,
  WorkspaceCtr,
] as const satisfies readonly IpcServiceConstructor[];

type DesktopControllerIpcConstructors = typeof controllerIpcConstructors;
type DesktopControllerServices = CreateServicesResult<DesktopControllerIpcConstructors>;
export type DesktopIpcServices = MergeIpcService<DesktopControllerServices>;
