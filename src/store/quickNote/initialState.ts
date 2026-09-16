import type { QuickNoteAgenticDetails, QuickNoteItem } from '@/services/quickNote';

export type QuickNoteSaveStatus = 'failed' | 'idle' | 'saved' | 'saving';

export const UNCATEGORIZED_KEY = 'uncategorized';

export interface QuickNoteState {
  activeCollection: string | null;
  activeNoteId?: string;
  activeTag: string | null;
  /** Agent sidecar data cached independently for each opened Quick Note. */
  agenticDetailMap: Record<string, QuickNoteAgenticDetails>;
  /** Note identifiers whose explicit Analyze request is in flight. */
  analyzingNoteIds: string[];
  annotationPanelExpanded: boolean;
  /** Note identifiers whose feedback submission is in flight. */
  creatingCommentNoteIds: string[];
  divingNoteIds: string[];
  /** Comment identifiers whose latest edit is being persisted. */
  editingCommentIds: string[];
  notes: QuickNoteItem[];
  notesInit: boolean;
  /** Whether the latest initial note-list request failed and can be retried. */
  notesLoadError: boolean;
  /** Proposal identifiers currently being edited or decided. */
  processingProposalIds: string[];
  saveStatus: QuickNoteSaveStatus;
  searchKeywords: string;
}

export const initialState: QuickNoteState = {
  activeCollection: null,
  activeTag: null,
  agenticDetailMap: {},
  analyzingNoteIds: [],
  annotationPanelExpanded: true,
  creatingCommentNoteIds: [],
  divingNoteIds: [],
  editingCommentIds: [],
  notes: [],
  notesInit: false,
  notesLoadError: false,
  processingProposalIds: [],
  saveStatus: 'idle',
  searchKeywords: '',
};
