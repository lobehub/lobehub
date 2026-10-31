import type { ChatToolPayload } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, eq, inArray, isNull, not, or } from 'drizzle-orm';

import { messagePlugins, messages, topics } from '../../schemas';
import {
  isTrashed,
  restoreStamp,
  type SoftDeleteOptions,
  trashStamp,
} from '../../utils/softDelete';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { recomputeTopicUsage } from '../topicUsage';
import { nonNull } from '../utils/rows';
import type { MessageBranchSnapshots } from './branchSnapshots';
import type { MessageScopeArgs } from './scope';
import { MessageScope } from './scope';
import type { SoftDeletedMessage } from './types';

export class MessageTrashMutations extends MessageScope {
  private readonly snapshots: MessageBranchSnapshots;

  constructor(args: MessageScopeArgs, deps: { snapshots: MessageBranchSnapshots }) {
    super(...args);
    this.snapshots = deps.snapshots;
  }

  /**
   * Move messages to the recycle bin. Mirrors {@link deleteMessages} step for
   * step — tool companions are pulled in, live children are re-parented onto
   * the nearest surviving ancestor, the active-branch pointer is reconciled and
   * the topic usage rollup recomputed — but the rows are stamped instead of
   * dropped. Returns one entry per stamped row with the tree data a restore
   * needs to splice it back (`parentId` + the child ids that were re-parented
   * away from it), and whether the row was an explicitly requested root or a
   * tool companion pulled in with it.
   */
  softDeleteMessages = async (
    ids: string[],
    options: SoftDeleteOptions,
  ): Promise<SoftDeletedMessage[]> => {
    if (ids.length === 0) return [];

    return this.db.transaction(async (tx) => {
      const requested = await tx
        .select({
          content: messages.content,
          id: messages.id,
          parentId: messages.parentId,
          projectId: topics.projectId,
          role: messages.role,
          tools: messages.tools,
          topicId: messages.topicId,
        })
        .from(messages)
        .leftJoin(
          topics,
          and(
            eq(messages.topicId, topics.id),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
          ),
        )
        .where(and(this.ownership(), inArray(messages.id, ids)));
      if (requested.length === 0) return [];

      // Tool companions: the tool-result rows of a trashed assistant turn go
      // with it (same rule as the hard delete).
      const toolCallIds = requested
        .flatMap((row) => ((row.tools as ChatToolPayload[]) ?? []).map((tool) => tool.id))
        .filter(Boolean);
      const requestedIds = new Set(requested.map((row) => row.id));
      // toolCallId → the requested row that issued it, so each companion is
      // attributed to its own assistant turn rather than to the batch.
      const toolCallOwner = new Map<string, string>();
      for (const row of requested) {
        for (const tool of (row.tools as ChatToolPayload[]) ?? []) {
          if (tool.id) toolCallOwner.set(tool.id, row.id);
        }
      }
      const companionOwner = new Map<string, string>();
      let companions: typeof requested = [];
      if (toolCallIds.length > 0) {
        const companionRows = await tx
          .select({ id: messagePlugins.id, toolCallId: messagePlugins.toolCallId })
          .from(messagePlugins)
          .where(inArray(messagePlugins.toolCallId, toolCallIds));
        for (const row of companionRows) {
          // `inArray(messagePlugins.toolCallId, …)` excludes NULL.
          const owner = toolCallOwner.get(nonNull(row.toolCallId, 'message_plugins.tool_call_id'));
          if (owner && !requestedIds.has(row.id)) companionOwner.set(row.id, owner);
        }
        const companionIds = [...companionOwner.keys()];
        if (companionIds.length > 0) {
          companions = await tx
            .select({
              content: messages.content,
              id: messages.id,
              parentId: messages.parentId,
              projectId: topics.projectId,
              role: messages.role,
              tools: messages.tools,
              topicId: messages.topicId,
            })
            .from(messages)
            .leftJoin(
              topics,
              and(
                eq(messages.topicId, topics.id),
                buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
              ),
            )
            .where(and(this.ownership(), inArray(messages.id, companionIds)));
        }
      }

      const toDelete = [...requested, ...companions];
      const deleteIds = toDelete.map((row) => row.id);
      const deleteSet = new Set(deleteIds);
      const parentMap = new Map(toDelete.map((row) => [row.id, row.parentId] as const));

      const finalAncestorMap = new Map<string, string | null>();
      const findFinalAncestor = (id: string): string | null => {
        if (finalAncestorMap.has(id)) return finalAncestorMap.get(id)!;
        const parentId = parentMap.get(id);
        if (parentId === null || parentId === undefined) {
          finalAncestorMap.set(id, null);
          return null;
        }
        if (!deleteSet.has(parentId)) {
          finalAncestorMap.set(id, parentId);
          return parentId;
        }
        const ancestor = findFinalAncestor(parentId);
        finalAncestorMap.set(id, ancestor);
        return ancestor;
      };
      for (const id of deleteSet) findFinalAncestor(id);

      const activeBranchSnapshots = await this.snapshots.captureActiveBranchSnapshots(
        tx,
        [...new Set(finalAncestorMap.values())].filter((id): id is string => id !== null),
      );

      // Live children re-parented onto the nearest surviving ancestor —
      // remembered per message so a restore can hand them back.
      const children = await tx
        .select({ id: messages.id, parentId: messages.parentId })
        .from(messages)
        .where(
          and(
            this.ownership(),
            inArray(messages.parentId, deleteIds),
            not(inArray(messages.id, deleteIds)),
          ),
        );
      const childIdsByParent = new Map<string, string[]>();
      for (const child of children) {
        const list = childIdsByParent.get(child.parentId!) ?? [];
        list.push(child.id);
        childIdsByParent.set(child.parentId!, list);
        await tx
          .update(messages)
          .set({ parentId: finalAncestorMap.get(child.parentId!) ?? null })
          .where(and(eq(messages.id, child.id), this.ownership()));
      }

      await tx
        .update(messages)
        .set(trashStamp(options.deletedAt))
        .where(and(this.ownership(), inArray(messages.id, deleteIds)));

      await this.snapshots.reconcileActiveBranchSnapshots(tx, activeBranchSnapshots);

      const affectedTopicIds = [
        ...new Set(toDelete.map((m) => m.topicId).filter(Boolean) as string[]),
      ];
      for (const topicId of affectedTopicIds) {
        await recomputeTopicUsage(tx, this.userId, topicId, this.workspaceId);
      }

      return toDelete.map((row) => ({
        childIds: childIdsByParent.get(row.id) ?? [],
        content: row.content,
        id: row.id,
        isCompanion: !requestedIds.has(row.id),
        ownerId: companionOwner.get(row.id) ?? null,
        parentId: row.parentId,
        projectId: row.projectId,
        role: row.role,
        topicId: row.topicId,
      }));
    });
  };

  /**
   * Bring trashed messages back and splice them into their branch: the stamp
   * is cleared and the children recorded at trash time are re-parented onto
   * the message again (best effort — a child that has since moved or gone is
   * left alone). The active-branch pointer of the parent keeps pointing at
   * whatever branch is active today.
   */
  restoreMessages = async (
    entries: { childIds?: string[]; id: string; parentId?: string | null }[],
  ): Promise<string[]> => {
    if (entries.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const ids = entries.map((entry) => entry.id);
      const rows = await tx
        .select({ id: messages.id, parentId: messages.parentId, topicId: messages.topicId })
        .from(messages)
        .where(and(this.trashScope(), inArray(messages.id, ids), isTrashed(messages.isDeleted)));
      if (rows.length === 0) return [];

      const parentIds = rows.map((row) => row.parentId).filter((id): id is string => !!id);
      const activeBranchSnapshots = await this.snapshots.captureActiveBranchSnapshots(
        tx,
        parentIds,
      );

      // Report what the write restored, not what the read saw: a purge that
      // commits in between leaves nothing to update, and the caller must not
      // count that row as restored.
      const updated = await tx
        .update(messages)
        .set(restoreStamp())
        .where(
          and(
            this.trashScope(),
            inArray(
              messages.id,
              rows.map((row) => row.id),
            ),
            isTrashed(messages.isDeleted),
          ),
        )
        .returning({ id: messages.id });
      const restoredIds = new Set(updated.map((row) => row.id));

      for (const entry of entries) {
        if (!restoredIds.has(entry.id) || !entry.childIds?.length) continue;
        await tx
          .update(messages)
          .set({ parentId: entry.id })
          .where(and(inArray(messages.id, entry.childIds), this.trashScope()));
      }

      // While the row was in the bin its children hung off its parent, and the
      // user may have picked one of them as the active branch there. They now
      // move back under the restored row, so carry that choice up to it —
      // otherwise reconciliation cannot find the child among the parent's
      // branches, drops the selection and the view can jump to a sibling.
      const restoredAncestorOf = new Map<string, string>();
      for (const entry of entries) {
        if (!restoredIds.has(entry.id)) continue;
        for (const childId of entry.childIds ?? []) restoredAncestorOf.set(childId, entry.id);
      }
      for (const snapshot of activeBranchSnapshots) {
        const ancestor = snapshot.activeBranchId && restoredAncestorOf.get(snapshot.activeBranchId);
        if (ancestor) snapshot.activeBranchId = ancestor;
      }

      await this.snapshots.reconcileActiveBranchSnapshots(tx, activeBranchSnapshots);

      const affectedTopicIds = [...new Set(rows.map((m) => m.topicId).filter(Boolean) as string[])];
      for (const topicId of affectedTopicIds) {
        await recomputeTopicUsage(tx, this.userId, topicId, this.workspaceId);
      }
      return [...restoredIds];
    });
  };

  findTrashedByIds = async (ids: string[]) => {
    if (ids.length === 0) return [];
    return this.db
      .select({
        agentId: messages.agentId,
        id: messages.id,
        parentId: messages.parentId,
        sessionId: messages.sessionId,
        topicId: messages.topicId,
      })
      .from(messages)
      .where(and(this.trashScope(), inArray(messages.id, ids), isTrashed(messages.isDeleted)));
  };

  /**
   * Cascade helper for trashing an agent: stamps the live messages that hang
   * off the given agents or their legacy session shells WITHOUT a topic. Rows
   * inside a topic are hidden by that topic's own stamp; topic-less rows have
   * no parent to hide them (`workspaceScope()` treats them as live), so they
   * are stamped directly and registered as the agent's children. Their branch
   * stays intact, so a plain restore of the same ids brings them back.
   */
  softDeleteTopicless = async (
    parents: { agentIds?: string[]; sessionIds?: string[] },
    options: SoftDeleteOptions,
  ) => {
    const conditions: SQL[] = [];
    if (parents.agentIds?.length) conditions.push(inArray(messages.agentId, parents.agentIds));
    if (parents.sessionIds?.length)
      conditions.push(inArray(messages.sessionId, parents.sessionIds));
    if (conditions.length === 0) return [];

    return this.db
      .update(messages)
      .set(trashStamp(options.deletedAt))
      .where(and(isNull(messages.topicId), or(...conditions), this.ownership()))
      .returning({ content: messages.content, id: messages.id, role: messages.role });
  };

  /**
   * Hard delete for the purge sweep. Children were already re-parented at trash
   * time and usage already excludes stamped rows, so this is a plain delete
   * keyed on `scope()`.
   */
  purgeMessages = async (ids: string[]) => {
    if (ids.length === 0) return;
    // Only rows still stamped: a restore that commits between the purge's
    // registry read and this delete must win.
    return this.db
      .delete(messages)
      .where(and(this.trashScope(), inArray(messages.id, ids), isTrashed(messages.isDeleted)));
  };
}
