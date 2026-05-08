import type { AgentSignalSource } from '@lobechat/agent-signal';

export interface EmitSourceEventInput {
  payload: Record<string, unknown>;
  scopeKey: string;
  sourceId: string;
  sourceType: AgentSignalSource['sourceType'];
  timestamp: number;
}

export interface SourceRenderer {
  render: (input: EmitSourceEventInput) => AgentSignalSource;
  sourceType: AgentSignalSource['sourceType'];
}
