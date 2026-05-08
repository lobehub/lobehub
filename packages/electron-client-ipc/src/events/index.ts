import type { ACPBroadcastEvents } from './acp';
import type { GatewayConnectionBroadcastEvents } from './gatewayConnection';
import type { NavigationBroadcastEvents } from './navigation';
import type { ProtocolBroadcastEvents } from './protocol';
import type { RemoteServerBroadcastEvents } from './remoteServer';
import type { ScreenCaptureBroadcastEvents } from './screenCapture';
import type { SystemBroadcastEvents } from './system';
import type { TopicPopupBroadcastEvents } from './topicPopup';
import type { AutoUpdateBroadcastEvents } from './update';

/**
 * main -> render broadcast events
 */

export interface MainBroadcastEvents
  extends
    ACPBroadcastEvents,
    AutoUpdateBroadcastEvents,
    GatewayConnectionBroadcastEvents,
    NavigationBroadcastEvents,
    RemoteServerBroadcastEvents,
    ScreenCaptureBroadcastEvents,
    SystemBroadcastEvents,
    TopicPopupBroadcastEvents,
    ProtocolBroadcastEvents {}

export type MainBroadcastEventKey = keyof MainBroadcastEvents;

export type MainBroadcastParams<T extends MainBroadcastEventKey> = Parameters<
  MainBroadcastEvents[T]
>[0];

export type { GatewayConnectionStatus } from './gatewayConnection';
export type {
  AuthorizationPhase,
  AuthorizationProgress,
  MarketAuthorizationParams,
} from './remoteServer';
export type { OverlayDispatchMessagePayload } from './screenCapture';
export type { OpenSettingsWindowOptions } from './windows';
