import { diagnoseTopic, type TopicDiagnosis } from '@lobechat/conversation-flow';
import { and, eq, inArray } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { MessageModel } from '../../models/message';
import { messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

interface TopicScope {
  agentId?: string | null;
  topicId: string;
}

export interface RepairResult {
  /** Ops actually written */
  applied: number;
  /** Messages the reader was dropping that it will now render */
  restoredMessageIds: string[];
}

/**
 * TopicDoctorRepo — finds the messages a topic's tree hides from the reader, and rewrites
 * the minimum needed to bring them back.
 *
 * The patch is always re-derived here from the database rather than taken from the caller:
 * the client's copy of the tree can be stale, and this rewrites conversation history, so it
 * is worth paying a read to be certain of what is being changed.
 */
export class TopicDoctorRepo {
  private db: LobeChatDatabase;
  private messageModel: MessageModel;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.messageModel = new MessageModel(db, userId, workspaceId);
  }

  private ws = (cols: { userId: AnyPgColumn; workspaceId: AnyPgColumn }) =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, cols);

  diagnose = async ({ agentId, topicId }: TopicScope): Promise<TopicDiagnosis> => {
    // The same list the client renders from, so the `parse()` inside the diagnosis sees
    // exactly what the user sees.
    const list = await this.messageModel.query({ agentId, topicId });

    return diagnoseTopic(list as any);
  };

  repair = async (scope: TopicScope): Promise<RepairResult> => {
    const diagnosis = await this.diagnose(scope);
    const { patch } = diagnosis;
    if (patch.length === 0) return { applied: 0, restoredMessageIds: [] };

    // `diagnoseTopic()` appends one patch for each repairable issue, in issue order.
    // Keep them paired so a repair rejected by the write-side validation cannot still be
    // reported to the client as restored.
    const repairableIssues = diagnosis.issues.filter((issue) => issue.repairable);
    if (repairableIssues.length !== patch.length) {
      throw new Error('Topic Doctor diagnosis returned mismatched issues and repair operations');
    }
    const repairs = patch.map((op, index) => ({ issue: repairableIssues[index]!, op }));

    // Only ever touch real rows of this topic that the caller owns. The synthetic group
    // nodes `query()` splices into the list are not messages and must never be written to.
    const rowIds = [
      ...new Set(
        patch.flatMap((op) =>
          op.type === 'reparent' ? [op.messageId, op.parentId] : [op.messageId],
        ),
      ),
    ];
    const rows = await this.db
      .select({ id: messages.id, metadata: messages.metadata, parentId: messages.parentId })
      .from(messages)
      .where(
        and(eq(messages.topicId, scope.topicId), this.ws(messages), inArray(messages.id, rowIds)),
      );

    const rowById = new Map(rows.map((row) => [row.id, row]));
    const writable = repairs.filter(
      ({ op }) => rowById.has(op.messageId) && (op.type !== 'reparent' || rowById.has(op.parentId)),
    );

    await this.db.transaction(async (tx) => {
      for (const { op } of writable) {
        const current = rowById.get(op.messageId)!;
        const metadata = (current.metadata ?? {}) as Record<string, any>;

        // Keep what the row looked like before, so a bad repair can be walked back.
        const next: Record<string, any> =
          op.type === 'reparent'
            ? { ...metadata, repairedFrom: { parentId: current.parentId } }
            : {
                ...metadata,
                activeBranchIndex: op.index,
                repairedFrom: { activeBranchIndex: metadata.activeBranchIndex ?? null },
              };

        await tx
          .update(messages)
          .set({
            metadata: next,
            ...(op.type === 'reparent' ? { parentId: op.parentId } : {}),
            // A repair changes how history is threaded, not when it was written.
            updatedAt: messages.updatedAt,
          })
          .where(and(eq(messages.id, op.messageId), this.ws(messages)));
      }
    });

    // Both the messages a repair un-hides and the detached sections it reconnects count as
    // "brought back": the latter rendered before, but stranded on their own root and severed
    // from the model's context — putting them back in the chain is the point of the fix.
    const restoredMessageIds = [
      ...new Set(
        writable.flatMap(({ issue }) => [
          ...issue.hiddenMessageIds,
          ...(issue.reattachedMessageIds ?? []),
        ]),
      ),
    ];

    return { applied: writable.length, restoredMessageIds };
  };
}
