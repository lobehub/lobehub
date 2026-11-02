import type { QuickNoteAgenticDetails, QuickNoteItem, QuickNoteTask } from '@/services/quickNote';

export type QuickNoteSaveStatus = 'failed' | 'idle' | 'saved' | 'saving';

export const UNCATEGORIZED_KEY = 'uncategorized';

export interface QuickNoteState {
  activeCollection: string | null;
  activeNoteId?: string;
  activeTag: string | null;
  /** Agent sidecar data cached independently for each opened Quick Note. */
  agenticDetailMap: Record<string, QuickNoteAgenticDetails>;
  /** Whether the AI side panel beside the editor is open. */
  aiPanelExpanded: boolean;
  /** Note identifiers whose explicit Analyze request is in flight. */
  analyzingNoteIds: string[];
  /** Note identifiers whose feedback submission is in flight. */
  creatingCommentNoteIds: string[];
  /** Note identifiers whose Dive (create-and-run Task) request is in flight. */
  divingNoteIds: string[];
  /** Comment identifiers whose latest edit is being persisted. */
  editingCommentIds: string[];
  notes: QuickNoteItem[];
  /** Whether the server holds notes after the loaded list pages. */
  notesHasMore: boolean;
  notesInit: boolean;
  /** Whether the latest initial note-list request failed and can be retried. */
  notesLoadError: boolean;
  /** Whether the next list page is being loaded. */
  notesLoadingMore: boolean;
  /** Whether loading the next list page failed and can be retried. */
  notesLoadMoreError: boolean;
  /** Proposal identifiers currently being edited or decided. */
  processingProposalIds: string[];
  saveStatus: QuickNoteSaveStatus;
  searchKeywords: string;
  /** Tasks each opened Quick Note started (applied Proposals and Dives), newest first. */
  taskMap: Record<string, QuickNoteTask[]>;
}

export const initialState: QuickNoteState = {
  activeCollection: null,
  activeTag: null,
  agenticDetailMap: {},
  aiPanelExpanded: true,
  analyzingNoteIds: [],
  creatingCommentNoteIds: [],
  divingNoteIds: [],
  editingCommentIds: [],
  notes: [],
  notesHasMore: false,
  notesInit: false,
  notesLoadError: false,
  notesLoadMoreError: false,
  notesLoadingMore: false,
  processingProposalIds: [],
  saveStatus: 'idle',
  searchKeywords: '',
  taskMap: {},
};
