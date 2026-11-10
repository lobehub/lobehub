import type { Message } from '@lobechat/conversation-flow';
import { parse } from '@lobechat/conversation-flow';
import debug from 'debug';
import pMap from 'p-map';

import type { MessageModel } from '@/database/models/message';

const log = debug('lobe-server:ai-agent-service');

/**
 * A row of the topic conversation as returned by `MessageModel.query`, the same
 * input the runtime parses to rebuild model context at every step.
 */
export type ConversationMessage = Message;

export interface ResolveUserMessageParentIdParams {
  /**
   * Tail of the branch the client is rendering (`clientIds.userMessageParentId`).
   * Absent for callers that have no rendered conversation (bots, CLI, older
   * clients); the server then derives the tail of the selected branch itself.
   */
  clientParentId?: string;
  /** Topic (or thread) conversation loaded through `MessageModel.query`. */
  messages: ConversationMessage[];
  threadId: string | null;
  topicId: string;
}

const toTime = (value: unknown) => new Date(value as string | number | Date).getTime() || 0;

/**
 * Ids of every message the active branch renders: the same `parse()` the chat UI
 * and the runtime context rebuild use, so "rendered here" means "the user sees it
 * and the model reads it". Nested group members and tool results carry their own
 * ids, so the walk collects ids from the whole flat-list structure.
 */
const collectActiveBranchIds = (messages: ConversationMessage[], threadId: string | null) => {
  const { flatList } = parse(messages, undefined, { threadId });
  const ids = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'id' || key === 'result_msg_id') && typeof value === 'string') ids.add(value);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(flatList);
  return ids;
};

/**
 * Same filter as `MessageModel.getLatestSpineMessageId`: tool results are inline
 * children of their assistant turn, and a toolless signal turn is a reactive
 * side-channel, so neither is a conversation head a new turn parents off.
 */
const isSpineCandidate = (message: ConversationMessage, threadId: string | null) => {
  if (message.role === 'tool') return false;
  if ((message.threadId ?? null) !== threadId) return false;
  const isSignal = !!message.metadata && 'signal' in message.metadata;
  return !isSignal || (message.tools?.length ?? 0) > 0;
};

/**
 * `MessageModel.query` folds message groups into synthetic rows whose id is the
 * group's, not a `messages` row, so it cannot be a `parentId`. Resolve them to the
 * real message the client treats as the tail (`findLastMessageIdRecursive`): the
 * last compare column, or the last compressed message.
 */
const toMessageRowId = (message: ConversationMessage): string | undefined => {
  if (message.role === 'compareGroup') {
    return (message as { children?: { id: string }[] }).children?.at(-1)?.id;
  }
  if (message.role === 'compressedGroup') {
    return (message as { lastMessageId?: string }).lastMessageId;
  }
  return message.id;
};

const isDescendantOrSelf = (
  byId: Map<string, ConversationMessage>,
  descendantId: string,
  ancestorId: string,
) => {
  const visited = new Set<string>();
  let current: string | null | undefined = descendantId;
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = byId.get(current)?.parentId;
  }
  return false;
};

/**
 * Pick the parent for a fresh user turn appended to an existing topic.
 *
 * The turn continues the branch the user selected. The old rule anchored on the
 * newest row by `createdAt`, but after a regenerate the newest row lives on the
 * regenerated branch; when the reply switcher points at an earlier reply, every
 * new turn landed on a hidden branch, vanished from the UI, and never reached
 * the model, which rebuilds context from the selected branch.
 *
 * - The client's rendered tail wins: "reply to what I see" is the user's intent,
 *   and the branch selection it switched to may not be persisted yet, or another
 *   tab may have switched the shared selection since.
 * - The newest spine message replaces that tail only when it continues the tail
 *   on the selected branch (a turn persisted while the user was composing), so a
 *   stale tail does not fork the conversation.
 * - Without a client tail, the newest spine message on the selected branch is
 *   the head, which also covers released clients, bots and the CLI.
 *
 * Never returns undefined for a topic that already has messages:
 * `parentId: undefined` persists a second ROOT, and the renderer walks the
 * parentId forest depth-first, so the newest reply would land above older ones.
 * When nothing on the selected branch qualifies, it keeps the old spine anchor
 * and finally the latest non-tool row (a topic built only from signal turns).
 */
export const resolveUserMessageParentId = async (
  messageModel: Pick<
    MessageModel,
    'findById' | 'getLatestNonToolMessageId' | 'getLatestSpineMessageId'
  >,
  { clientParentId, messages, threadId, topicId }: ResolveUserMessageParentIdParams,
): Promise<string | undefined> => {
  const byId = new Map(messages.map((message) => [message.id, message]));

  let clientTailId: string | undefined;
  if (clientParentId) {
    // The tail is caller input: only honour it when it really belongs to this
    // conversation, otherwise a stale or foreign id would graft the turn
    // somewhere the user cannot see.
    const clientParent = byId.get(clientParentId) ?? (await messageModel.findById(clientParentId));
    const sameConversation =
      byId.has(clientParentId) ||
      (clientParent?.topicId === topicId && (clientParent.threadId ?? null) === threadId);
    if (clientParent && sameConversation) {
      // A rendered tail can be a tool result; the turn parents off the
      // assistant that owns it, never the tool row. A group id resolves to
      // its real message like the server-derived head below.
      clientTailId =
        clientParent.role === 'tool' && clientParent.parentId
          ? clientParent.parentId
          : toMessageRowId(clientParent as ConversationMessage);
    }
  }

  if (messages.length > 0) {
    const activeIds = collectActiveBranchIds(messages, threadId);
    // Newest first. Rows from one turn can share a JS millisecond while the DB
    // orders them by microsecond `createdAt` then id, so ties fall back to the
    // query position; otherwise a user row could outrank its own reply.
    const headId = messages
      .map((message, position) => ({ message, position }))
      .filter(({ message }) => isSpineCandidate(message, threadId) && activeIds.has(message.id))
      .sort(
        (a, b) =>
          toTime(b.message.createdAt) - toTime(a.message.createdAt) || b.position - a.position,
      )
      .map(({ message }) => toMessageRowId(message))
      .find(
        (id): id is string => !!id && (!clientTailId || isDescendantOrSelf(byId, id, clientTailId)),
      );
    if (headId) return headId;
  }

  if (clientTailId) return clientTailId;

  const spineId = await messageModel.getLatestSpineMessageId({ threadId, topicId });
  if (spineId) return spineId;

  const fallbackId = await messageModel.getLatestNonToolMessageId({ threadId, topicId });
  if (fallbackId) {
    log(
      'execAgent: no spine head for topic %s, anchoring user turn on latest non-tool message %s',
      topicId,
      fallbackId,
    );
  }
  return fallbackId;
};

/**
 * Branch-index updates that put `leafId` on the selected branch: at every branch
 * point above it, `activeBranchIndex` must select the child on the path to the
 * leaf. Indices use the reader's canonical branch space — non-tool children in
 * query order — so `BranchResolver` resolves the same child.
 */
const computeBranchSelection = (
  messages: ConversationMessage[],
  leafId: string,
  threadId: string | null,
) => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const childrenByParent = new Map<string, string[]>();
  for (const message of messages) {
    if (!message.parentId) continue;
    if (message.threadId && message.threadId !== threadId) continue;
    const siblings = childrenByParent.get(message.parentId) ?? [];
    siblings.push(message.id);
    childrenByParent.set(message.parentId, siblings);
  }

  const updates = new Map<string, number>();
  let child = byId.get(leafId);
  while (child?.parentId) {
    const parent = byId.get(child.parentId);
    if (!parent) break;
    if (child.role !== 'tool') {
      const branchIds = (childrenByParent.get(parent.id) ?? []).filter(
        (id) => byId.get(id)?.role !== 'tool',
      );
      const index = branchIds.indexOf(child.id);
      const current = (parent.metadata as { activeBranchIndex?: unknown } | undefined)
        ?.activeBranchIndex;
      if (index >= 0 && (branchIds.length > 1 || typeof current === 'number') && current !== index)
        updates.set(parent.id, index);
    }
    child = parent;
  }
  return updates;
};

export interface SelectBranchOfMessageParams {
  /** The freshly persisted user turn. */
  message: ConversationMessage;
  /** The conversation the parent was resolved from, before the new turn. */
  messages: ConversationMessage[];
  threadId: string | null;
}

/**
 * Make the selected branch contain the user turn just persisted.
 *
 * The UI and the runtime both follow the persisted `activeBranchIndex`. When the
 * turn was anchored on the client's tail while the stored selection still points
 * elsewhere (the switch has not been saved yet, or another tab switched since),
 * the turn would be persisted but neither rendered after a reload nor given to
 * the model. Updating the branch points on its path keeps storage, display and
 * model context on the same branch. The update is applied only when re-parsing
 * proves it makes the turn visible, so unusual tree shapes are left untouched.
 */
export const selectBranchOfMessage = async (
  messageModel: Pick<MessageModel, 'updateMetadata'>,
  { message, messages, threadId }: SelectBranchOfMessageParams,
): Promise<void> => {
  const conversation = [...messages, message];
  if (collectActiveBranchIds(conversation, threadId).has(message.id)) return;

  const updates = computeBranchSelection(conversation, message.id, threadId);
  if (updates.size === 0) return;

  const selected = conversation.map((item) =>
    updates.has(item.id)
      ? { ...item, metadata: { ...item.metadata, activeBranchIndex: updates.get(item.id) } }
      : item,
  );
  if (!collectActiveBranchIds(selected, threadId).has(message.id)) {
    log('execAgent: cannot select the branch of user turn %s; leaving selection as is', message.id);
    return;
  }

  await pMap(
    [...updates],
    ([id, activeBranchIndex]) => messageModel.updateMetadata(id, { activeBranchIndex }),
    { concurrency: 5 },
  );
};

export interface UserTurnAnchorParams {
  /** Share-visitor runs read the visitor topic under the creator's identity. */
  allowShareVisitor: boolean;
  clientParentId?: string;
  groupId?: string;
  sessionId?: string | null;
  threadId: string | null;
  topicId: string;
}

/**
 * Anchor a fresh user turn on the selected branch: `resolveParentId` loads the
 * conversation once (the same read as the history loader, so share and group runs
 * see what the runtime will parse) and picks the parent; `selectBranchOf` then
 * puts the persisted turn on the selected branch. `selectBranchOf` is a no-op
 * when the parent came from elsewhere (resume, new thread, run from history).
 */
export const createUserTurnAnchor = (
  messageModel: Pick<
    MessageModel,
    | 'findById'
    | 'getLatestNonToolMessageId'
    | 'getLatestSpineMessageId'
    | 'query'
    | 'updateMetadata'
  >,
  {
    allowShareVisitor,
    clientParentId,
    groupId,
    sessionId,
    threadId,
    topicId,
  }: UserTurnAnchorParams,
) => {
  let messages: ConversationMessage[] | undefined;

  return {
    resolveParentId: async () => {
      // `parse()` never reads Work summaries, so skip their join on the send path.
      messages = await messageModel.query(
        {
          groupId,
          sessionId: sessionId ?? undefined,
          skipWorks: true,
          threadId: threadId ?? undefined,
          topicId,
        },
        { allowShareVisitor },
      );
      return resolveUserMessageParentId(messageModel, {
        clientParentId,
        messages,
        threadId,
        topicId,
      });
    },
    selectBranchOf: async (message: { id: string }) => {
      if (!messages?.length) return;
      // Best effort: a failed selection update leaves the turn persisted on the
      // right parent, which switching branches can still reveal.
      try {
        await selectBranchOfMessage(messageModel, {
          message: message as ConversationMessage,
          messages,
          threadId,
        });
      } catch (error) {
        console.error('[execAgent] Failed to select the branch of the user turn: %O', error);
      }
    },
  };
};
