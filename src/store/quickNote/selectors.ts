import type { QuickNoteItem, QuickNoteProposal, QuickNoteTask } from '@/services/quickNote';

import { type QuickNoteState, UNCATEGORIZED_KEY } from './initialState';

export interface QuickNoteBucket {
  count: number;
  name: string;
}

const matchFilters = (note: QuickNoteItem, s: QuickNoteState): boolean => {
  if (s.activeCollection === UNCATEGORIZED_KEY) {
    if (note.collection) return false;
  } else if (s.activeCollection && note.collection !== s.activeCollection) {
    return false;
  }

  if (s.activeTag && !note.tags.includes(s.activeTag)) return false;

  const keywords = s.searchKeywords.trim().toLowerCase();
  if (keywords && !note.content.toLowerCase().includes(keywords)) return false;

  return true;
};

const filteredNotes = (s: QuickNoteState): QuickNoteItem[] =>
  s.notes.filter((note) => matchFilters(note, s)).sort((a, b) => b.createdAt - a.createdAt);

const totalCount = (s: QuickNoteState): number => s.notes.length;

const uncategorizedCount = (s: QuickNoteState): number =>
  s.notes.filter((note) => !note.collection).length;

const countBuckets = (values: string[]): QuickNoteBucket[] => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const collections = (s: QuickNoteState): QuickNoteBucket[] =>
  countBuckets(s.notes.map((note) => note.collection).filter(Boolean) as string[]);

const tags = (s: QuickNoteState): QuickNoteBucket[] =>
  countBuckets(s.notes.flatMap((note) => note.tags));

const noteById =
  (id?: string) =>
  (s: QuickNoteState): QuickNoteItem | undefined =>
    id ? s.notes.find((note) => note.id === id) : undefined;

/**
 * What the AI panel's summary slot shows:
 * - `ready`: a summary exists.
 * - `emptyNote`: nothing written yet.
 * - `none`: the latest analysis finished without a summary (keep-only or page-write notes).
 * - `waiting`: analysis has not finished yet (scheduled, running, failed, or never run).
 */
export type QuickNoteSummaryState = 'emptyNote' | 'none' | 'ready' | 'waiting';

export interface QuickNoteAiPanelView {
  exists: boolean;
  hasContent: boolean;
  summaryContent?: string;
  summaryState: QuickNoteSummaryState;
  tags: string[];
}

const resolveSummaryState = (note?: QuickNoteItem): QuickNoteSummaryState => {
  if (note?.summary?.content) return 'ready';
  if (!note?.content.trim()) return 'emptyNote';
  // A newer revision is waiting for its own analysis; the finished one may still summarize it.
  if (note.run?.status === 'completed' && !note.analyzeDueAt) return 'none';
  return 'waiting';
};

/**
 * Selects only the note fields the AI panel displays.
 *
 * Use when:
 * - A subscriber must ignore note content edits beyond the empty/non-empty boundary.
 *
 * Expects:
 * - Callers compare the result with `fast-deep-equal`, since each call builds a new object.
 * - The run is read separately through `runById`, so its reference stays stable for memoized
 *   run views when only the summary or tags change.
 */
const aiPanelViewById =
  (id: string) =>
  (s: QuickNoteState): QuickNoteAiPanelView => {
    const note = noteById(id)(s);
    return {
      exists: Boolean(note),
      hasContent: Boolean(note?.content.trim()),
      summaryContent: note?.summary?.content,
      summaryState: resolveSummaryState(note),
      tags: note?.tags ?? [],
    };
  };

const runById =
  (id: string) =>
  (s: QuickNoteState): QuickNoteItem['run'] =>
    noteById(id)(s)?.run;

const activeNote = (s: QuickNoteState): QuickNoteItem | undefined => noteById(s.activeNoteId)(s);

const isDiving =
  (id: string) =>
  (s: QuickNoteState): boolean =>
    s.divingNoteIds.includes(id);

const agenticDetailsById = (id: string) => (s: QuickNoteState) => s.agenticDetailMap[id];

const isCreatingComment = (id: string) => (s: QuickNoteState) =>
  s.creatingCommentNoteIds.includes(id);

const isAnalyzing = (id: string) => (s: QuickNoteState) => s.analyzingNoteIds.includes(id);

const isEditingComment = (id: string) => (s: QuickNoteState) => s.editingCommentIds.includes(id);

const isProcessingProposal = (id: string) => (s: QuickNoteState) =>
  s.processingProposalIds.includes(id);

const EMPTY_PROPOSALS: QuickNoteProposal[] = [];
const EMPTY_TASKS: QuickNoteTask[] = [];

/** Whether the user can still apply, edit, or dismiss a Proposal. Stale ones stay actionable. */
export const isQuickNoteProposalActionable = (proposal: QuickNoteProposal): boolean =>
  proposal.decisionStatus === 'pending' && proposal.validity !== 'superseded';

/** Pending Proposals the user can act on, including those whose source text changed. */
const actionableProposalsById = (id: string) => (s: QuickNoteState) =>
  (s.agenticDetailMap[id]?.proposals ?? EMPTY_PROPOSALS).filter(isQuickNoteProposalActionable);

/** Decided or superseded Proposals, shown collapsed as history. */
const archivedProposalsById = (id: string) => (s: QuickNoteState) =>
  (s.agenticDetailMap[id]?.proposals ?? EMPTY_PROPOSALS).filter(
    (proposal) => !isQuickNoteProposalActionable(proposal),
  );

/** Tasks the note started, or an empty list before the first load. */
const tasksById = (id: string) => (s: QuickNoteState) => s.taskMap[id] ?? EMPTY_TASKS;

export const quickNoteSelectors = {
  actionableProposalsById,
  activeNote,
  agenticDetailsById,
  aiPanelViewById,
  archivedProposalsById,
  collections,
  filteredNotes,
  isAnalyzing,
  isCreatingComment,
  isDiving,
  isEditingComment,
  isProcessingProposal,
  noteById,
  runById,
  tags,
  tasksById,
  totalCount,
  uncategorizedCount,
};
