import type { OpenAIChatMessage } from '../../openai/chat';

/** A rendered machine contribution. The anchor describes its historical placement. */
export interface ContextReplaySegment {
  key: string;
  messages: Array<OpenAIChatMessage & { id: string }>;
  sourceIds: string[];
}

/** One logical LLM invocation's immutable delta; stored before dispatch, never in Redis state. */
export interface ContextReplayExecutionBinding {
  agentDeviceId: string | null;
  topicDeviceId: string | null;
}

export interface ContextReplaySnapshot {
  changes: ContextReplaySegment[];
  createdBy?: string;
  executionBinding?: ContextReplayExecutionBinding;
  historyStartId?: string;
  invalidated?: boolean;
  invocationId: string;
  parentSnapshotId?: string;
  sessionKey: string;
  sourceIds: string[];
  /** Present at the start of a baseline, not copied into every subsequent delta. */
  system?: OpenAIChatMessage[];
  toolDefinitions?: Record<string, string>;
  version: 1;
}
