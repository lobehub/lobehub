import type { ChatToolPayload } from '@lobechat/types';
import { and, eq, inArray, isNull, not, or } from 'drizzle-orm';

import { agentsToSessions, messagePlugins, messages } from '../../schemas';
import { notShareVisitorMessage } from '../../utils/shareVisitor';
import { recomputeTopicUsage } from '../topicUsage';
import type { MessageBranchSnapshots } from './branchSnapshots';
import type { MessageScopeArgs } from './scope';
import { MessageScope } from './scope';
import type { ShareVisitorWriteOptions } from './types';

export class MessageDeleteMutations extends MessageScope {
  private readonly snapshots: MessageBranchSnapshots;

  constructor(args: MessageScopeArgs, deps: { snapshots: MessageBranchSnapshots }) {
    super(...args);
    this.snapshots = deps.snapshots;
  }

  /**
   * Delete one message (plus the tool messages it owns).
   *
   * Agent-share visitor messages live under the creator's `userId`, so plain
   * ownership matches them: by default this refuses to touch them, which keeps
   * the creator-facing `message.removeMessage` from destroying a visitor's
   * conversation even when the creator obtained a raw visitor message id (e.g.
   * through data export). The agent runtime — which also runs visitor turns
   * under the creator's identity and must clean up its own placeholders — opts
   * back in with `includeShareVisitor`.
   */
  deleteMessage = async (id: string, options?: ShareVisitorWriteOptions) => {
    // Effective visitor gate: per-call `true` OR the instance flag widens the
    // scope. Uses `workspaceScope()` (raw) so an instance-default caller can
    // still opt in per-call without `ownership()` re-adding the exclusion.
    const includeVisitor = options?.includeShareVisitor || this.includeShareVisitor;
    const scope = includeVisitor ? this.workspaceScope() : this.ownership();

    return this.db.transaction(async (tx) => {
      // 1. Query the complete information of the message to be deleted
      const message = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, id), scope))
        .limit(1);

      // If the message to be deleted is not found, return directly
      if (message.length === 0) return;

      const activeBranchSnapshots = await this.snapshots.captureActiveBranchSnapshots(
        tx,
        message[0].parentId ? [message[0].parentId] : [],
      );

      // 2. Update child messages' parentId to the current message's parentId
      // This preserves the tree structure when deleting a node
      await tx
        .update(messages)
        .set({ parentId: message[0].parentId })
        .where(and(eq(messages.parentId, id), scope));

      // 3. Check if the message contains tools
      const toolCallIds = (message[0].tools as ChatToolPayload[])
        ?.map((tool) => tool.id)
        .filter(Boolean);

      let relatedMessageIds: string[] = [];

      if (toolCallIds?.length > 0) {
        // 4. If the message contains tools, query all associated message ids
        const res = await tx
          .select({ id: messagePlugins.id })
          .from(messagePlugins)
          .where(inArray(messagePlugins.toolCallId, toolCallIds));

        relatedMessageIds = res.map((row) => row.id);
      }

      // 5. Merge the list of message ids to be deleted
      const messageIdsToDelete = [id, ...relatedMessageIds];

      // 6. Delete all related messages
      await tx.delete(messages).where(and(scope, inArray(messages.id, messageIdsToDelete)));

      await this.snapshots.reconcileActiveBranchSnapshots(tx, activeBranchSnapshots);

      // 7. Keep the topic's usage rollup in sync (pure derived — a removed
      // assistant message must drop out of the topic totals).
      if (message[0].topicId) {
        await recomputeTopicUsage(tx, this.userId, message[0].topicId, this.workspaceId);
      }
    });
  };

  /**
   * Batch twin of {@link MessageModel.deleteMessage} — same agent-share visitor
   * rule: visitor messages are skipped unless the caller explicitly opts in.
   */
  deleteMessages = async (ids: string[], options?: ShareVisitorWriteOptions) => {
    if (ids.length === 0) return;

    const includeVisitor = options?.includeShareVisitor || this.includeShareVisitor;
    const scope = includeVisitor ? this.workspaceScope() : this.ownership();

    return this.db.transaction(async (tx) => {
      // 1. Query all messages to be deleted with their parentId
      const toDelete = await tx
        .select({ id: messages.id, parentId: messages.parentId, topicId: messages.topicId })
        .from(messages)
        .where(and(scope, inArray(messages.id, ids)));

      if (toDelete.length === 0) return;

      // 2. Build id -> parentId map and deleteSet
      const parentMap = new Map<string, string | null>();
      const deleteSet = new Set<string>();
      for (const msg of toDelete) {
        parentMap.set(msg.id, msg.parentId);
        deleteSet.add(msg.id);
      }

      // 3. Find the final ancestor for each deleted message (first ancestor not in deleteSet)
      const finalAncestorMap = new Map<string, string | null>();

      const findFinalAncestor = (id: string): string | null => {
        if (finalAncestorMap.has(id)) return finalAncestorMap.get(id)!;

        const parentId = parentMap.get(id);
        if (parentId === null || parentId === undefined) {
          finalAncestorMap.set(id, null);
          return null;
        }

        if (!deleteSet.has(parentId)) {
          // Parent is not being deleted, it's the final ancestor
          finalAncestorMap.set(id, parentId);
          return parentId;
        }

        // Parent is also being deleted, recursively find its ancestor
        const ancestor = findFinalAncestor(parentId);
        finalAncestorMap.set(id, ancestor);
        return ancestor;
      };

      for (const id of deleteSet) {
        findFinalAncestor(id);
      }

      const activeBranchSnapshots = await this.snapshots.captureActiveBranchSnapshots(
        tx,
        [...new Set(finalAncestorMap.values())].filter((id): id is string => id !== null),
      );

      // 4. Query child messages whose parentId points to messages being deleted
      const children = await tx
        .select({ id: messages.id, parentId: messages.parentId })
        .from(messages)
        .where(and(scope, inArray(messages.parentId, ids), not(inArray(messages.id, ids))));

      // 5. Update each child's parentId to the final ancestor
      for (const child of children) {
        const newParentId = finalAncestorMap.get(child.parentId!) ?? null;
        await tx
          .update(messages)
          .set({ parentId: newParentId })
          .where(and(eq(messages.id, child.id), scope));
      }

      // 6. Delete the messages. Deletes the ids that survived the step-1
      // filter, not the raw input, so a mixed batch drops only the visitor rows.
      await tx.delete(messages).where(and(scope, inArray(messages.id, [...deleteSet])));

      await this.snapshots.reconcileActiveBranchSnapshots(tx, activeBranchSnapshots);

      // 7. Recompute the usage rollup for every affected topic (pure derived).
      const affectedTopicIds = [
        ...new Set(toDelete.map((m) => m.topicId).filter(Boolean) as string[]),
      ];
      for (const topicId of affectedTopicIds) {
        await recomputeTopicUsage(tx, this.userId, topicId, this.workspaceId);
      }
    });
  };

  /**
   * Creator-facing "clear this session/topic/group" sweep.
   *
   * Agent-share visitor messages live under the creator's `userId` but are
   * hidden from every creator-facing listing (see `notShareVisitorMessage` in
   * `../utils/shareVisitor`), so an id-less sweep must not destroy them —
   * same rule as {@link deleteAllMessages}. Runtime cleanup opts back in via
   * `includeShareVisitor`.
   */
  deleteMessagesBySession = async (
    sessionId?: string | null,
    topicId?: string | null,
    groupId?: string | null,
    options?: ShareVisitorWriteOptions & { agentId?: string },
  ) => {
    const includeVisitor = options?.includeShareVisitor || this.includeShareVisitor;
    const scope = includeVisitor ? this.workspaceScope() : this.ownership();

    return this.db.delete(messages).where(
      and(
        scope,
        // Concrete topics are authorized by the caller and may contain
        // delegated replies from several Agents, just like topic reads.
        topicId
          ? undefined
          : options?.agentId
            ? or(
                eq(messages.agentId, options.agentId),
                sessionId
                  ? and(isNull(messages.agentId), eq(messages.sessionId, sessionId))
                  : undefined,
                this.matchLegacyInbox(options.agentId),
              )
            : this.matchSession(sessionId),
        this.matchTopic(topicId),
        this.matchGroup(groupId),
      ),
    );
  };

  /**
   * Creator-facing "clear all my messages".
   *
   * Agent-share visitor messages are stored under the creator's `userId` but
   * are hidden from every creator-facing listing (see `notShareVisitorMessage`
   * in `../utils/shareVisitor`), so an id-less sweep must not destroy them —
   * "clear all" can only mean the rows the creator can actually see. Id-targeted
   * deletes ({@link MessageModel.deleteMessage}, {@link MessageModel.deleteMessages})
   * apply the same guard by default — a creator can obtain visitor ids out of
   * band (data export), so "the caller named the id" is not proof the row is
   * theirs to delete. Runtime cleanup opts back in via `includeShareVisitor`.
   */
  deleteAllMessages = async () => {
    return this.db.delete(messages).where(and(this.ownership(), notShareVisitorMessage()));
  };

  /**
   * Deletes multiple messages based on the agentId.
   * This will delete messages that have either:
   * 1. Direct agentId match (new data)
   * 2. SessionId match via agentsToSessions lookup (legacy data)
   *
   * This is the creator's "clear this agent's messages" action, so visitor
   * messages are excluded (see {@link deleteAllMessages}). Deleting the agent
   * itself is a different path: `messages.agent_id` / `topics.agent_id` cascade
   * at the DB level, so visitor rows do go away with the agent.
   */
  batchDeleteByAgentId = async (agentId: string) => {
    // Get the associated sessionId for backward compatibility with legacy data
    const agentSession = await this.db
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, agentId), this.agentsToSessionsOwnership()))
      .limit(1);

    const associatedSessionId = agentSession[0]?.sessionId;

    // Build condition to match both new (agentId) and legacy (sessionId) data
    const agentCondition = associatedSessionId
      ? or(eq(messages.agentId, agentId), eq(messages.sessionId, associatedSessionId))
      : eq(messages.agentId, agentId);

    return this.db
      .delete(messages)
      .where(and(this.ownership(), agentCondition, notShareVisitorMessage()));
  };
}
