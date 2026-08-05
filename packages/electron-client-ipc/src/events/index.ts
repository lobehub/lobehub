import type { ACPBroadcastEvents } from './acp';
import type { BrowserSidebarBroadcastEvents } from './browserSidebar';
import type { GatewayConnectionBroadcastEvents } from './gatewayConnection';
import type { HeterogeneousAgentBroadcastEvents } from './heterogeneousAgent';
import type { NavigationBroadcastEvents } from './navigation';
import type { ProtocolBroadcastEvents } from './protocol';
import type { RemoteServerBroadcastEvents } from './remoteServer';
import type { ScreenCaptureBroadcastEvents } from './screenCapture';
import type { SystemBroadcastEvents } from './system';
import type { TerminalBroadcastEvents } from './terminal';
import type { TopicPopupBroadcastEvents } from './topicPopup';
import type { AutoUpdateBroadcastEvents } from './update';
import type { ZoomBroadcastEvents } from './zoom';

/**
 * main -> render broadcast events
 */

export interface MainBroadcastEvents
  extends
    ACPBroadcastEvents,
    AutoUpdateBroadcastEvents,
    BrowserSidebarBroadcastEvents,
    GatewayConnectionBroadcastEvents,
    HeterogeneousAgentBroadcastEvents,
    NavigationBroadcastEvents,
    RemoteServerBroadcastEvents,
    ScreenCaptureBroadcastEvents,
    SystemBroadcastEvents,
    TerminalBroadcastEvents,
    TopicPopupBroadcastEvents,
    ZoomBroadcastEvents,
    ProtocolBroadcastEvents {}

export type MainBroadcastEventKey = keyof MainBroadcastEvents;

export type MainBroadcastParams<T extends MainBroadcastEventKey> = Parameters<
  MainBroadcastEvents[T]
>[0];

export type { GatewayConnectionStatus } from './gatewayConnection';
export type {
  DetectAppsResult,
  DetectedApp,
  OpenInAppId,
  OpenInAppParams,
  OpenInAppResult,
} from './openInApp';
export type {
  AuthorizationPhase,
  AuthorizationProgress,
  MarketAuthorizationParams,
} from './remoteServer';
export type { OverlayDispatchMessagePayload } from './screenCapture';
export type { OpenSettingsWindowOptions } from './windows';
