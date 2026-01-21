import { NavigationBroadcastEvents } from './navigation';
import { ProtocolBroadcastEvents } from './protocol';
import { RemoteServerBroadcastEvents } from './remoteServer';
import { SystemBroadcastEvents } from './system';
import { AutoUpdateBroadcastEvents } from './update';

/**
 * main -> render broadcast events
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
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
