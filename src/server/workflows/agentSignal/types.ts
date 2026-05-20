import type { AgentSignalSourceEvent, AgentSignalSourceType } from '@lobechat/agent-signal/source';

type AgentSignalWorkflowSourceType = AgentSignalSourceType;

/**
 * One normalized Agent Signal source event handed to the workflow worker.
 *
 * @param TSourceType - Concrete Agent Signal source type accepted by this payload.
 */
export interface AgentSignalWorkflowSourceEventInput<
  TSourceType extends AgentSignalWorkflowSourceType = AgentSignalWorkflowSourceType,
> extends AgentSignalSourceEvent<TSourceType> {}

/** One Upstash workflow payload for Agent Signal execution. */
export interface AgentSignalWorkflowRunPayload {
  /** Optional assistant identifier used to keep workflow emissions tied to the originating agent. */
  agentId?: string;
  /** Normalized source event consumed by the Agent Signal workflow worker. */
  sourceEvent: AgentSignalWorkflowSourceEventInput;
  /** Owner of the source event and all database lookups performed by the workflow worker. */
  userId: string;
}
