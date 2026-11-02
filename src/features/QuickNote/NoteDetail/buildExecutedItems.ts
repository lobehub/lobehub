import {
  getQuickNoteProposalPreview,
  type QuickNoteProposal,
  type QuickNoteTask,
} from '@/services/quickNote';

import type { QuickNoteOpenTarget } from './resolveResourceOpenTarget';

/** Product object families a Quick Note can produce. */
export type QuickNoteExecutedType = 'goal' | 'page' | 'task' | 'topic';

/** One object the note produced: a Task it started or an applied Proposal's result. */
export interface QuickNoteExecutedItem {
  /** Sort time in milliseconds, newest first. */
  at: number;
  key: string;
  /** Task status when known. */
  status?: string;
  /** Where clicking the row goes; absent when the object cannot be opened. */
  target?: QuickNoteOpenTarget;
  title: string;
  type: QuickNoteExecutedType;
}

const EXECUTED_TYPES = new Set<string>(['goal', 'page', 'task', 'topic']);

/**
 * Resolves where an applied Proposal's result opens.
 *
 * Returns:
 * - A native open target, or `undefined` when the Proposal produced nothing openable.
 */
export const resolveQuickNoteProposalResultTarget = (
  proposal: QuickNoteProposal,
  inboxAgentId?: string,
): QuickNoteOpenTarget | undefined => {
  const { resultId, resultType } = proposal;
  if (!resultId) return undefined;

  switch (resultType) {
    case 'task': {
      return { kind: 'task', taskId: resultId };
    }
    case 'goal': {
      return { goalId: resultId, kind: 'goal' };
    }
    case 'page': {
      return { documentId: resultId, kind: 'document' };
    }
    case 'topic': {
      // The topic executor falls back to the Inbox agent when the payload names none.
      const payloadAgentId = proposal.payload.agentId;
      const agentId = typeof payloadAgentId === 'string' ? payloadAgentId : inboxAgentId;
      return agentId ? { agentId, kind: 'topic', topicId: resultId } : undefined;
    }
    default: {
      return undefined;
    }
  }
};

/**
 * Merges the Tasks a note started with its applied Proposals' results.
 *
 * Use when:
 * - The note sidebar lists what was executed on the user's behalf.
 *
 * Expects:
 * - `tasks` come from `quickNote.listTasks`; an applied `task` Proposal whose Task is already
 *   listed is shown once, as that Task.
 *
 * Returns:
 * - Rows newest first, each with an open target when one is available.
 */
export const buildQuickNoteExecutedItems = (
  tasks: QuickNoteTask[],
  proposals: QuickNoteProposal[],
  inboxAgentId?: string,
): QuickNoteExecutedItem[] => {
  const taskIds = new Set(tasks.map((task) => task.id));
  const items: QuickNoteExecutedItem[] = tasks.map((task) => ({
    at: task.createdAt,
    key: `task:${task.id}`,
    status: task.status,
    target: { kind: 'task', taskId: task.identifier || task.id },
    title: task.name?.trim() || task.identifier,
    type: 'task',
  }));

  for (const proposal of proposals) {
    const { resultId, resultType } = proposal;
    if (proposal.decisionStatus !== 'accepted' || !resultId || !resultType) continue;
    if (!EXECUTED_TYPES.has(resultType)) continue;
    if (resultType === 'task' && taskIds.has(resultId)) continue;

    const type = resultType as QuickNoteExecutedType;
    items.push({
      at: proposal.decidedAt ?? proposal.updatedAt,
      key: `${type}:${resultId}`,
      target: resolveQuickNoteProposalResultTarget(proposal, inboxAgentId),
      title: getQuickNoteProposalPreview(proposal.kind, proposal.payload).title || resultId,
      type,
    });
  }

  return items.sort((a, b) => b.at - a.at);
};
