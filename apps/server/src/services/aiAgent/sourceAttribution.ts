import type { AgentSenderMetadata } from '@lobechat/types';
import debug from 'debug';

const log = debug('lobe-server:ai-agent-source-attribution');

/** The slice of an `agent_operations` row this decision reads. */
export interface SourceOperationRow {
  topicId?: null | string;
  userId: string;
}

/** The slice of a `topics` row this decision reads. */
export interface SourceTopicRow {
  agentId?: null | string;
  title?: null | string;
}

/** The slice of the sending agent's config that is snapshotted for display. */
export interface SourceAgentConfigRow {
  avatar?: null | string;
  name?: null | string;
  title?: null | string;
}

export interface SourceAttributionDeps {
  findAgentConfig: (agentId: string) => Promise<SourceAgentConfigRow | null | undefined>;
  findOperation: (operationId: string) => Promise<null | SourceOperationRow | undefined>;
  findTopic: (topicId: string) => Promise<null | SourceTopicRow | undefined>;
  /** The authenticated caller — attribution may only rest on THEIR OWN work. */
  userId: string;
}

/**
 * Resolve the agent that launched an agent → agent run into the snapshot the UI
 * renders as the message author (`metadata.agentSender`).
 *
 * The caller names only the **operation** its launcher's run belongs to
 * (the ambient `LOBEHUB_OPERATION_ID`), never a topic and never an agent: both
 * are read from the operation row **the server wrote itself**, so a caller
 * cannot point the attribution at a conversation it had nothing to do with.
 *
 * The row must belong to the caller. `AgentOperationModel.findById` is
 * workspace-scoped, so in a workspace it also returns a *sibling member's*
 * operation — without this ownership check, any member holding `message:create`
 * could render arbitrary text as another member's agent.
 *
 * Attribution is display-only, so an unknown operation, a missing topic, or a
 * since-deleted agent degrades to "no attribution" rather than failing a run
 * that is otherwise perfectly valid.
 */
export const resolveAgentSenderFromOperation = async (
  sourceOperationId: string | undefined,
  deps: SourceAttributionDeps,
): Promise<AgentSenderMetadata | undefined> => {
  if (!sourceOperationId) return undefined;

  const operation = await deps.findOperation(sourceOperationId);
  if (!operation || operation.userId !== deps.userId || !operation.topicId) return undefined;

  const topic = await deps.findTopic(operation.topicId);
  if (!topic?.agentId) return undefined;

  const base: AgentSenderMetadata = {
    agentId: topic.agentId,
    topicId: operation.topicId,
    topicTitle: topic.title ?? undefined,
  };

  try {
    const config = await deps.findAgentConfig(topic.agentId);
    if (!config) return base;

    return {
      ...base,
      avatar: config.avatar ?? undefined,
      name: config.name ?? undefined,
      title: config.title ?? undefined,
    };
  } catch (error) {
    log('failed to resolve source agent %s: %O', topic.agentId, error);
    return base;
  }
};
