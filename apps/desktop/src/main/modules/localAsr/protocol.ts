import type {
  LocalAsrJobProgressPayload,
  LocalAsrRealtimeEvent,
} from '@lobechat/electron-client-ipc';

import type { StartSessionInput, TranscribeFileInput } from './engine';

/** Messages between the main process and the local ASR utility process. */
export type EngineRequest =
  | { id: number; method: 'cancelSession'; params: { sessionId: string } }
  | { id: number; method: 'ping'; params: Record<string, never> }
  | { id: number; method: 'startSession'; params: StartSessionInput }
  | { id: number; method: 'stopSession'; params: { sessionId: string } }
  | { id: number; method: 'transcribeFile'; params: TranscribeFileInput };

export type HostToEngineMessage =
  ({ type: 'request' } & EngineRequest) | { frame: Uint8Array; sessionId: string; type: 'audio' };

export type EngineToHostMessage =
  | { error?: string; id: number; result?: unknown; type: 'response' }
  | { event: LocalAsrRealtimeEvent; type: 'event' }
  | { payload: LocalAsrJobProgressPayload; type: 'progress' }
  | { error: string; type: 'fatal' };
