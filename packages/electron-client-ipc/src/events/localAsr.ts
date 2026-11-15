import type {
  LocalAsrJobProgressPayload,
  LocalAsrModelProgressPayload,
  LocalAsrRealtimeEvent,
} from '../types/localAsr';

export interface LocalAsrBroadcastEvents {
  localAsrEvent: (event: LocalAsrRealtimeEvent) => void;
  localAsrJobProgress: (payload: LocalAsrJobProgressPayload) => void;
  localAsrModelProgress: (payload: LocalAsrModelProgressPayload) => void;
}
