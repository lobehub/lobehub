import type { AgentOperationStatus, AgentSenderMetadata } from '@lobechat/types';
import { isAgentOperationInFlight } from '@lobechat/types';
import debug from 'debug';

const log = debug('lobe-server:ai-agent-source-attribution');

/**
 * How many agent → agent sends may follow each other before a person has to
 * step in. Each send started by an agent turn that was itself started by
 * another agent's send counts one more (`AgentSenderMetadata.hop`); without a
 * bound, two agents told to report back to each other wake each other forever.
 */
export const MAX_AGENT_RELAY_HOPS = 5;

/** A send would exceed {@link MAX_AGENT_RELAY_HOPS}; the run is not started. */
export class AgentRelayHopLimitError extends Error {
  constructor(readonly hop: number) {
    super(
      `Agent relay limit reached: this would be agent-to-agent send #${hop} in a row (at most ${MAX_AGENT_RELAY_HOPS}). Ask the user how to continue instead of sending again.`,
    );
    this.name = 'AgentRelayHopLimitError';
  }
}

/** Refuse a resolved sender past the relay bound — see {@link MAX_AGENT_RELAY_HOPS}. */
export const assertAgentRelayHop = (sender: AgentSenderMetadata | undefined) => {
  if (sender?.hop && sender.hop > MAX_AGENT_RELAY_HOPS) {
    throw new AgentRelayHopLimitError(sender.hop);
  }
};

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
  workspaceId?: null | string;
}

/** The slice of a `topics` row this decision reads. */
export interface SourceTopicRow {
  agentId?: null | string;
  title?: null | string;
  workspaceId?: null | string;
}

/** The slice of the sending agent's row that is snapshotted for display. */
export interface SourceAgentDisplayRow {
  avatar?: null | string;
  name?: null | string;
  title?: null | string;
}

export interface SourceAttributionDeps {
  /** The agent whose conversation will host the message. */
  destinationAgentId: string;
  findAgentDisplayFields: (agentId: string) => Promise<SourceAgentDisplayRow | null | undefined>;
  findAgentVisibility: (agentId: string) => Promise<'private' | 'public' | null>;
  findChatGroupVisibility: (chatGroupId: string) => Promise<'private' | 'public' | null>;
  findOperation: (operationId: string) => Promise<null | SourceOperationRow | undefined>;
  findTopic: (topicId: string) => Promise<null | SourceTopicRow | undefined>;
  /**
   * The relay hop of the newest user message on the sending conversation —
   * the one that started (or last steered) the sending turn — or undefined when
   * a person wrote it.
   */
  findTriggerHop: (params: { threadId?: string; topicId: string }) => Promise<number | undefined>;
  /** The authenticated caller — attribution may only rest on THEIR OWN work. */
  userId: string;
  /** The caller's active workspace; undefined in personal scope. */
  workspaceId?: string;
}

/**
 * Whether the source conversation may be named (and linked) in the destination
 * bubble.
 *
 * A workspace-shared agent's conversation is readable by every member; a private
 * one only by its owner, who is the caller. So the origin is snapshotted only
 * when the same people can open it — otherwise a private topic's name, which is
 * frequently derived from the user's own prompt, lands in a conversation other
 * members read. The authorship itself is never dropped; the inaccessible origin
 * is.
 */
const isSourceShareableWithDestination = async (
  deps: Pick<
    SourceAttributionDeps,
    'destinationAgentId' | 'findAgentVisibility' | 'findChatGroupVisibility' | 'workspaceId'
  >,
  source: { chatGroupId?: string; sourceWorkspaceId: null | string; topicAgentId?: string },
): Promise<boolean> => {
  const destinationVisibility = await deps.findAgentVisibility(deps.destinationAgentId);
  const sharedDestination = Boolean(deps.workspaceId) && destinationVisibility === 'public';
  // Personal scope: the bubble is readable by the caller alone, who ran the source.
  if (!sharedDestination) return true;
  if (source.sourceWorkspaceId !== deps.workspaceId) return false;

  // Who can read the source is decided by the conversation the link opens, not
  // by the agent that ran: a group route is the group's, an agent route is the
  // topic owner's. A public `callSubAgent` child on a private parent's topic, or
  // a public member inside a private group, must not make that origin shareable.
  let sourceVisibility: 'private' | 'public' | null = null;
  if (source.chatGroupId) {
    sourceVisibility = await deps.findChatGroupVisibility(source.chatGroupId);
  } else if (source.topicAgentId) {
    sourceVisibility = await deps.findAgentVisibility(source.topicAgentId);
  }

  return sourceVisibility === 'public';
};

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
  // A group topic may legitimately have no owning agent (legacy or API-created
  // rows) while the operation still names the agent that ran. The group route
  // needs no topic agent, so only a one-to-one topic has to resolve one.
  if (!operation.chatGroupId && !topic?.agentId) return undefined;

  // The AUTHOR is whoever ran the operation, which is not always the topic's
  // owner: a heterogeneous `callSubAgent` child executes in an isolation thread
  // on its SPAWNER's topic, so the child sends while the topic belongs to the
  // parent. The topic's owner is kept separately, because the jump-back link has
  // to target the conversation the topic actually lives in.
  const senderAgentId = operation.agentId ?? topic?.agentId;
  if (!senderAgentId) return undefined;

  // The source may be private while the destination is workspace-shared: the
  // topic's name is often prompt-derived, so snapshotting it into a bubble every
  // member can read would leak the source to people who cannot open it. Keep the
  // authorship, drop the origin they have no access to.
  const shareable = await isSourceShareableWithDestination(deps, {
    chatGroupId: operation.chatGroupId ?? undefined,
    sourceWorkspaceId: topic?.workspaceId ?? operation.workspaceId ?? null,
    topicAgentId: topic?.agentId ?? undefined,
  });

  // Counted on the conversation the sending turn runs in, whether or not its
  // origin may be shown: the bound protects the runtime, not the display.
  const triggerHop = await deps
    .findTriggerHop({ threadId: operation.threadId ?? undefined, topicId: operation.topicId })
    .catch((error) => {
      log('failed to read the trigger hop of %s: %O', operation.topicId, error);
      return undefined;
    });

  const base: AgentSenderMetadata = {
    agentId: senderAgentId,
    // Group and thread are where the turn actually happened: without them the
    // jump-back opens the agent's own topic instead of the group, or the topic's
    // main transcript instead of the thread.
    chatGroupId: operation.chatGroupId ?? undefined,
    hop: (triggerHop ?? 0) + 1,
    threadId: operation.threadId ?? undefined,
    topicAgentId: topic?.agentId ?? undefined,
    topicId: shareable ? operation.topicId : undefined,
    topicTitle: shareable ? (topic?.title ?? undefined) : undefined,
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
