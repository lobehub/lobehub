import type { NavigationBroadcastEvents } from './navigation';
import type { ProtocolBroadcastEvents } from './protocol';
import type { RemoteServerBroadcastEvents } from './remoteServer';
import type { SystemBroadcastEvents } from './system';
import type { AutoUpdateBroadcastEvents } from './update';

/**
 * main -> render broadcast events
 */

export interface MainBroadcastEvents
  extends
    AutoUpdateBroadcastEvents,
    NavigationBroadcastEvents,
    RemoteServerBroadcastEvents,
    SystemBroadcastEvents,
    ProtocolBroadcastEvents {}

export type MainBroadcastEventKey = keyof MainBroadcastEvents;

export type MainBroadcastParams<T extends MainBroadcastEventKey> = Parameters<
  MainBroadcastEvents[T]
>[0];

export type {
  AuthorizationPhase,
  AuthorizationProgress,
  MarketAuthorizationParams,
} from './remoteServer';
export type { OpenSettingsWindowOptions } from './windows';
