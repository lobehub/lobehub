import type { QuickNoteAnalyzeTrigger } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

import type {
  QuickNoteAgenticDetails,
  QuickNoteComment,
  QuickNoteItem,
  QuickNoteProposal,
  QuickNoteResource,
} from './type';

export type {
  QuickNoteAgenticDetails,
  QuickNoteAnnotation,
  QuickNoteComment,
  QuickNoteItem,
  QuickNoteProposal,
  QuickNoteResource,
} from './type';

interface ServerQuickNoteItem {
  analyzeDueAt?: Date | string | null;
  annotation?: { content: string; divedAt: Date | string };
  collection?: string | null;
  content?: string | null;
  createdAt: Date | string;
  documentId: string;
  editorData?: Record<string, unknown> | null;
  id: string;
  location?: string | null;
  run?: QuickNoteItem['run'];
  tags: string[];
  topicId: string;
  updatedAt: Date | string;
}

interface ServerQuickNoteAgenticDetails {
  comments: Array<
    Omit<QuickNoteComment, 'createdAt' | 'updatedAt'> & {
      createdAt: Date | string;
      updatedAt: Date | string;
    }
  >;
  proposals: Array<
    Omit<QuickNoteProposal, 'createdAt' | 'updatedAt'> & {
      createdAt: Date | string;
      updatedAt: Date | string;
    }
  >;
  resources: Array<Omit<QuickNoteResource, 'createdAt'> & { createdAt: Date | string }>;
}

/**
 * Normalizes server dates and nullable storage fields for the existing Quick Note UI.
 *
 * Before:
 * - `{ createdAt: "2026-08-24T00:00:00Z", collection: null }`
 *
 * After:
 * - `{ createdAt: 1787529600000, collection: undefined }`
 */
const normalizeQuickNote = (note: ServerQuickNoteItem): QuickNoteItem => ({
  annotation: note.annotation
    ? { content: note.annotation.content, divedAt: new Date(note.annotation.divedAt).getTime() }
    : undefined,
  collection: note.collection ?? undefined,
  content: note.content ?? '',
  createdAt: new Date(note.createdAt).getTime(),
  analyzeDueAt: note.analyzeDueAt ? new Date(note.analyzeDueAt).getTime() : undefined,
  documentId: note.documentId,
  editorData: note.editorData ?? undefined,
  id: note.id,
  location: note.location ?? undefined,
  run: note.run,
  tags: note.tags,
  topicId: note.topicId,
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
  acceptProposal = async (proposalId: string) =>
    lambdaClient.quickNote.acceptProposal.mutate({ proposalId });

  createComment = async (quickNoteId: string, content: string) =>
    lambdaClient.quickNote.createComment.mutate({ content, quickNoteId });

  getNotes = async (): Promise<QuickNoteItem[]> => {
    const notes = await lambdaClient.quickNote.list.query();
    return notes.map((note) => normalizeQuickNote(note as ServerQuickNoteItem));
  };

  createNote = async (
    content = '',
    editorData?: Record<string, unknown>,
  ): Promise<QuickNoteItem> => {
    const note = await lambdaClient.quickNote.create.mutate({ content, editorData, tags: [] });
    return normalizeQuickNote({ ...note, content, editorData });
  };

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
  ): Promise<{ analyzeDueAt?: number }> => {
    const note = await lambdaClient.quickNote.updateContent.mutate({ content, editorData, id });
    return {
      analyzeDueAt: note.analyzeDueAt ? new Date(note.analyzeDueAt).getTime() : undefined,
    };
  };

  analyze = async (id: string, trigger: QuickNoteAnalyzeTrigger = 'manual') =>
    lambdaClient.quickNote.analyze.mutate({ id, trigger });

  dismissProposal = async (proposalId: string) =>
    lambdaClient.quickNote.decideProposal.mutate({ decisionStatus: 'dismissed', proposalId });

  updateComment = async (commentId: string, content: string) =>
    lambdaClient.quickNote.updateComment.mutate({ commentId, content });

  updateProposal = async (proposalId: string, content: string) =>
    lambdaClient.quickNote.updateProposal.mutate({
      content,
      editorData: { markdown: content },
      proposalId,
    });

  dive = async (id: string) => lambdaClient.quickNote.dive.mutate({ id });
}

export const quickNoteService = new QuickNoteService();
