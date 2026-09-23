import type { QuickNoteItem } from '@/services/quickNote';

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

const pendingProposalsById = (id: string) => (s: QuickNoteState) =>
  (s.agenticDetailMap[id]?.proposals ?? []).filter(
    (proposal) => proposal.decisionStatus === 'pending',
  );

export const quickNoteSelectors = {
  activeNote,
  agenticDetailsById,
  collections,
  filteredNotes,
  isAnalyzing,
  isCreatingComment,
  isDiving,
  isEditingComment,
  isProcessingProposal,
  noteById,
  pendingProposalsById,
  tags,
  totalCount,
  uncategorizedCount,
};
