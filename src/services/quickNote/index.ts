import type {
  QuickNoteAnalyzeTrigger,
  QuickNoteProposalPayload,
  QuickNoteResourceReference,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

import type {
  QuickNoteAgenticDetails,
  QuickNoteComment,
  QuickNoteDismissReason,
  QuickNoteItem,
  QuickNoteProposal,
  QuickNoteResource,
  QuickNoteTask,
} from './type';

export {
  getQuickNoteProposalField,
  getQuickNoteProposalPreview,
  QUICK_NOTE_PROPOSAL_FIELDS,
  type QuickNoteProposalField,
  type QuickNoteProposalFieldKey,
  setQuickNoteProposalFields,
} from './proposalText';
export type {
  QuickNoteAgenticDetails,
  QuickNoteComment,
  QuickNoteDismissReason,
  QuickNoteItem,
  QuickNoteProposal,
  QuickNoteResource,
  QuickNoteSummary,
  QuickNoteTask,
} from './type';
export { QUICK_NOTE_DISMISS_REASONS } from './type';

interface ServerQuickNoteItem {
  analyzeDueAt?: Date | string | null;
  collection?: string | null;
  content?: string | null;
  createdAt: Date | string;
  documentId: string;
  editorData?: Record<string, unknown> | null;
  id: string;
  location?: string | null;
  run?: Omit<NonNullable<QuickNoteItem['run']>, 'completedAt'> & {
    completedAt?: Date | string | null;
  };
  summary?: { completedAt: Date | string; content: string };
  tags: string[];
  updatedAt: Date | string;
}

/** Position after the last note of a list page, as returned by the server. */
export interface QuickNoteListCursor {
  createdAt: string;
  id: string;
}

/** One page of the note list; `nextCursor` is `null` on the last page. */
export interface QuickNoteListPage {
  items: QuickNoteItem[];
  nextCursor: QuickNoteListCursor | null;
}

interface ServerQuickNoteAgenticDetails {
  comments: Array<
    Omit<QuickNoteComment, 'createdAt' | 'updatedAt'> & {
      createdAt: Date | string;
      updatedAt: Date | string;
    }
  >;
  proposals: Array<
    Omit<QuickNoteProposal, 'createdAt' | 'decidedAt' | 'updatedAt'> & {
      createdAt: Date | string;
      decidedAt?: Date | string | null;
      updatedAt: Date | string;
    }
  >;
  resources: Array<Omit<QuickNoteResource, 'createdAt'> & { createdAt: Date | string }>;
}

/**
 * Normalizes server dates and nullable storage fields for the Quick Note UI.
 *
 * Before:
 * - `{ createdAt: "2026-08-24T00:00:00Z", collection: null }`
 *
 * After:
 * - `{ createdAt: 1787529600000, collection: undefined }`
 */
const normalizeQuickNote = (note: ServerQuickNoteItem): QuickNoteItem => ({
  collection: note.collection ?? undefined,
  content: note.content ?? '',
  createdAt: new Date(note.createdAt).getTime(),
  analyzeDueAt: note.analyzeDueAt ? new Date(note.analyzeDueAt).getTime() : undefined,
  documentId: note.documentId,
  editorData: note.editorData ?? undefined,
  id: note.id,
  location: note.location ?? undefined,
  run: note.run && {
    ...note.run,
    completedAt: note.run.completedAt ? new Date(note.run.completedAt).getTime() : null,
  },
  summary: note.summary
    ? { completedAt: new Date(note.summary.completedAt).getTime(), content: note.summary.content }
    : undefined,
  tags: note.tags,
  updatedAt: new Date(note.updatedAt).getTime(),
});

/**
 * Normalizes Agent sidecar dates for the browser store.
 *
 * Before:
 * - `{ comments: [{ createdAt: "2026-09-03T00:00:00Z" }] }`
 *
 * After:
 * - `{ comments: [{ createdAt: 1788393600000 }] }`
 */
const normalizeAgenticDetails = (
  details: ServerQuickNoteAgenticDetails,
): QuickNoteAgenticDetails => ({
  comments: details.comments.map((comment) => ({
    ...comment,
    createdAt: new Date(comment.createdAt).getTime(),
    updatedAt: new Date(comment.updatedAt).getTime(),
  })),
  proposals: details.proposals.map((proposal) => ({
    ...proposal,
    createdAt: new Date(proposal.createdAt).getTime(),
    decidedAt: proposal.decidedAt ? new Date(proposal.decidedAt).getTime() : null,
    updatedAt: new Date(proposal.updatedAt).getTime(),
  })),
  resources: details.resources.map((resource) => ({
    ...resource,
    createdAt: new Date(resource.createdAt).getTime(),
  })),
});

/**
 * Client boundary for server-backed Quick Note persistence and Agent Runs.
 *
 * Use when:
 * - The Quick Note Zustand store needs CRUD, Analyze, or Dive operations.
 *
 * Expects:
 * - UI components continue consuming the existing `QuickNoteItem` projection.
 *
 * Returns:
 * - Normalized client records and server-owned Run identities.
 */
class QuickNoteService {
  /** Applies a pending Proposal; idempotent, so a repeated call returns the stored result. */
  applyProposal = async (proposalId: string) =>
    lambdaClient.quickNote.applyProposal.mutate({ proposalId });

  createComment = async (quickNoteId: string, content: string) =>
    lambdaClient.quickNote.createComment.mutate({ content, quickNoteId });

  /** Reads one page of notes, newest first; omit `cursor` for the first page. */
  getNotes = async (cursor?: QuickNoteListCursor | null): Promise<QuickNoteListPage> => {
    const page = await lambdaClient.quickNote.list.query(cursor ? { cursor } : undefined);
    return {
      items: page.items.map((note) => normalizeQuickNote(note as ServerQuickNoteItem)),
      nextCursor: page.nextCursor,
    };
  };

  /** Reads one note with its latest Run; `undefined` when it no longer exists in this scope. */
  getNote = async (id: string): Promise<QuickNoteItem | undefined> => {
    const note = await lambdaClient.quickNote.detail.query({ id });
    return note ? normalizeQuickNote(note as ServerQuickNoteItem) : undefined;
  };

  createNote = async (
    content = '',
    editorData?: Record<string, unknown>,
    resources?: QuickNoteResourceReference[],
  ): Promise<QuickNoteItem> => {
    const note = await lambdaClient.quickNote.create.mutate({
      content,
      editorData,
      resources,
      tags: [],
    });
    return normalizeQuickNote({ ...note, content, editorData });
  };

  /**
   * Captures content sent from another surface with the objects it came from.
   *
   * TODO(quick-note subtask 6): wire the message / selection / Page / Topic entry points.
   */
  createNoteFromResources = async (
    resources: QuickNoteResourceReference[],
    content = '',
    editorData?: Record<string, unknown>,
  ): Promise<QuickNoteItem> => this.createNote(content, editorData, resources);

  getAgenticDetails = async (id: string): Promise<QuickNoteAgenticDetails> => {
    const details = await lambdaClient.quickNote.agenticDetails.query({ id });
    return normalizeAgenticDetails(details as ServerQuickNoteAgenticDetails);
  };

  removeNote = async (id: string): Promise<void> => {
    await lambdaClient.quickNote.delete.mutate({ id });
  };

  updateNoteContent = async (
    id: string,
    content: string,
    editorData: Record<string, unknown>,
  ): Promise<{
    analyzeDueAt?: number;
    /** `changed` when the text changed beyond cosmetics, so a meaning check is armed. */
    contentChange?: 'changed' | 'equivalent' | 'none';
    /** When the server's debounced meaning check becomes due, in milliseconds. */
    contentCheckDueAt?: number;
  }> => {
    const note = await lambdaClient.quickNote.updateContent.mutate({ content, editorData, id });
    return {
      analyzeDueAt: note.analyzeDueAt ? new Date(note.analyzeDueAt).getTime() : undefined,
      contentChange: note.contentChange,
      contentCheckDueAt: note.contentCheckDueAt
        ? new Date(note.contentCheckDueAt).getTime()
        : undefined,
    };
  };

  analyze = async (id: string, trigger: QuickNoteAnalyzeTrigger = 'manual') =>
    lambdaClient.quickNote.analyze.mutate({ id, trigger });

  dismissProposal = async (proposalId: string, reason?: QuickNoteDismissReason) =>
    lambdaClient.quickNote.decideProposal.mutate({
      decisionStatus: 'dismissed',
      proposalId,
      reason,
    });

  updateComment = async (commentId: string, content: string) =>
    lambdaClient.quickNote.updateComment.mutate({ commentId, content });

  updateProposal = async (proposalId: string, payload: QuickNoteProposalPayload) =>
    lambdaClient.quickNote.updateProposal.mutate({ payload, proposalId });

  /** Creates and starts a Task with the note as context; returns the new Task id. */
  dive = async (id: string): Promise<{ taskId: string }> =>
    lambdaClient.quickNote.dive.mutate({ id });

  /** Tasks this note started, newest first. */
  listTasks = async (id: string): Promise<QuickNoteTask[]> => {
    const tasks = await lambdaClient.quickNote.listTasks.query({ id });
    return tasks.map((task) => ({
      ...task,
      createdAt: new Date(task.createdAt).getTime(),
      updatedAt: new Date(task.updatedAt).getTime(),
    }));
  };
}

export const quickNoteService = new QuickNoteService();
