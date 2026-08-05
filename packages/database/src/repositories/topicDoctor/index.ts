import { diagnoseTopic, type TopicDiagnosis } from '@lobechat/conversation-flow';
import { and, eq, inArray } from 'drizzle-orm';

import { MessageModel } from '../../models/message';
import { messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildMessageScopeWhere } from '../../utils/messageScope';

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

  // messages.user_id/workspace_id are creation-time snapshots — derive scope
  // from the owning topic/session instead (see messageScope.ts).
  private messagesWs = () =>
    buildMessageScopeWhere({ userId: this.userId, workspaceId: this.workspaceId });

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

    // Only ever touch real rows of this topic that the caller owns. The synthetic group
    // nodes `query()` splices into the list are not messages and must never be written to.
    const targets = await this.db
      .select({ id: messages.id, metadata: messages.metadata, parentId: messages.parentId })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, scope.topicId),
          this.messagesWs(),
          inArray(
            messages.id,
            patch.map((op) => op.messageId),
          ),
        ),
      );

    const targetById = new Map(targets.map((row) => [row.id, row]));
    const writable = patch.filter((op) => targetById.has(op.messageId));

    await this.db.transaction(async (tx) => {
      for (const op of writable) {
        const current = targetById.get(op.messageId)!;
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
          .where(and(eq(messages.id, op.messageId), this.messagesWs()));
      }
    });

    // Both the messages a repair un-hides and the detached sections it reconnects count as
    // "brought back": the latter rendered before, but stranded on their own root and severed
    // from the model's context — putting them back in the chain is the point of the fix.
    const restoredMessageIds = [
      ...new Set(
        diagnosis.issues.flatMap((i) => [...i.hiddenMessageIds, ...(i.reattachedMessageIds ?? [])]),
      ),
    ];

    return { applied: writable.length, restoredMessageIds };
  };
}
