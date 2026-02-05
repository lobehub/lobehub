import type { TraceEventType, TraceNameMap } from './enum';

export interface TraceEventBasePayload {
  content: string;
  eventType: TraceEventType;
  observationId?: string;
  traceId: string;
}

export interface TraceEventModifyMessage {
  eventType: TraceEventType.ModifyMessage;
  nextContent: string;
}

export interface TraceEventDeleteAndRegenerateMessage {
  eventType: TraceEventType.DeleteAndRegenerateMessage;
}

export interface TraceEventCopyMessage {
  eventType: TraceEventType.CopyMessage;
}

export interface TraceEventRegenerateMessage {
  eventType: TraceEventType.RegenerateMessage;
}

export type TraceEventPayloads =
  | TraceEventCopyMessage
  | TraceEventModifyMessage
  | TraceEventDeleteAndRegenerateMessage
  | TraceEventRegenerateMessage;

export interface TracePayload {
  /**
   * if user allow to trace
   */
  enabled?: boolean;
  observationId?: string;
  /**
   * chat session: agentId or groupId
   */
  sessionId?: string;
  tags?: string[];
  /**
   * chat topicId
   */
  topicId?: string;
  traceId?: string;
  traceName?: TraceNameMap;
  /**
   * user uuid
   */
  userId?: string;
}
