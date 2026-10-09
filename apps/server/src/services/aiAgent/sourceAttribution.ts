import type { AgentOperationStatus, AgentSenderMetadata } from '@lobechat/types';
import { isAgentOperationInFlight } from '@lobechat/types';
import debug from 'debug';

const log = debug('lobe-server:ai-agent-source-attribution');

/** The slice of an `agent_operations` row this decision reads. */
export interface SourceOperationRow {
  /** The agent that RAN the operation — the sender, which is not always the topic's owner. */
  agentId?: null | string;
  /** Set when the turn ran in a group conversation rather than a one-to-one topic. */
  chatGroupId?: null | string;
  status?: AgentOperationStatus | null;
  /** Set when the turn ran inside a thread; the link reopens it. */
  threadId?: null | string;
  topicId?: null | string;
  userId: string;
}

/** The slice of a `topics` row this decision reads. */
export interface SourceTopicRow {
  agentId?: null | string;
  title?: null | string;
}

/** The slice of the sending agent's row that is snapshotted for display. */
export interface SourceAgentDisplayRow {
  avatar?: null | string;
  name?: null | string;
  title?: null | string;
}

export interface SourceAttributionDeps {
  findAgentDisplayFields: (agentId: string) => Promise<SourceAgentDisplayRow | null | undefined>;
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
 * The author is the operation's agent, and the topic's owner is carried
 * alongside it for the jump-back link — the two differ for a heterogeneous
 * `callSubAgent` child, which runs on its spawner's topic.
 *
 * The row must belong to the caller, and must still be in flight. `findById` is
 * workspace-scoped, so in a workspace it also returns a *sibling member's*
 * operation — without the ownership check, any member holding `message:create`
 * could render arbitrary text as another member's agent. Ownership alone is not
 * enough either: the operation id travels as an ambient env var and can be
 * replayed, so a settled run must stop granting attribution.
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
  // The claim has to be CURRENT, not merely owned. `LOBEHUB_OPERATION_ID` is an
  // env var: a shell or a long-lived child process keeps it after its run
  // finishes, so without this a later human-issued `lh agent run` — or a replay
  // of any prior operation id through the public API — would still render as
  // authored by that run's agent.
  if (!operation.status || !isAgentOperationInFlight(operation.status)) return undefined;

  const topic = await deps.findTopic(operation.topicId);
  if (!topic?.agentId) return undefined;

  // The AUTHOR is whoever ran the operation, which is not always the topic's
  // owner: a heterogeneous `callSubAgent` child executes in an isolation thread
  // on its SPAWNER's topic, so the child sends while the topic belongs to the
  // parent. The topic's owner is kept separately, because the jump-back link has
  // to target the conversation the topic actually lives in.
  const senderAgentId = operation.agentId ?? topic.agentId;

  const base: AgentSenderMetadata = {
    agentId: senderAgentId,
    // Group and thread are where the turn actually happened: without them the
    // jump-back opens the agent's own topic instead of the group, or the topic's
    // main transcript instead of the thread.
    chatGroupId: operation.chatGroupId ?? undefined,
    threadId: operation.threadId ?? undefined,
    topicAgentId: topic.agentId,
    topicId: operation.topicId,
    topicTitle: topic.title ?? undefined,
  };

  try {
    const config = await deps.findAgentDisplayFields(senderAgentId);
    if (!config) return base;

    return {
      ...base,
      avatar: config.avatar ?? undefined,
      name: config.name ?? undefined,
      title: config.title ?? undefined,
    };
  } catch (error) {
    log('failed to resolve source agent %s: %O', senderAgentId, error);
    return base;
  }
};
